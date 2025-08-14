// pages/api/data/[...key].js
import { getRequestContext } from "@cloudflare/next-on-pages";

export const config = { runtime: "edge" }; // run on the Edge runtime

function noStore(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, If-None-Match, If-Modified-Since",
    "Cache-Control": "no-store",
    ...extra,
  };
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: noStore({ "Access-Control-Max-Age": "86400" }) });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
  }

  // /api/data/<key...>
  const url = new URL(req.url);
  const key = url.pathname.replace(/^\/api\/data\//, "");
  if (!key || key.endsWith("/")) {
    return new Response(JSON.stringify({ error: "Missing object key" }), {
      status: 404,
      headers: noStore({ "Content-Type": "application/json; charset=utf-8" }),
    });
  }

  const { env } = getRequestContext(); // env.LEADERBOARDS is your R2 binding
  const head = await env.LEADERBOARDS.head(key);
  if (!head) {
    return new Response(JSON.stringify({ error: `No such object: ${key}` }), {
      status: 404,
      headers: noStore({ "Content-Type": "application/json; charset=utf-8" }),
    });
  }

  const etag = head.httpEtag || head.etag || "";
  const lastMod = head.uploaded
    ? new Date(head.uploaded).toUTCString()
    : new Date().toUTCString();

  // Conditional responses
  const inm = req.headers.get("If-None-Match");
  if (inm && etag && inm.replace(/^W\//, "") === etag.replace(/^W\//, "")) {
    return new Response(null, { status: 304, headers: noStore({ ETag: etag, "Last-Modified": lastMod }) });
  }
  const ims = req.headers.get("If-Modified-Since");
  if (ims && Date.parse(lastMod) <= Date.parse(ims)) {
    return new Response(null, { status: 304, headers: noStore({ ETag: etag, "Last-Modified": lastMod }) });
  }

  if (req.method === "HEAD") {
    return new Response(null, { headers: noStore({ ETag: etag, "Last-Modified": lastMod }) });
  }

  const obj = await env.LEADERBOARDS.get(key);
  if (!obj) {
    return new Response(JSON.stringify({ error: `No such object: ${key}` }), {
      status: 404,
      headers: noStore({ "Content-Type": "application/json; charset=utf-8" }),
    });
  }

  const ctype = (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream";
  const base = { ETag: etag, "Last-Modified": lastMod, "Content-Type": ctype };

  if (ctype.includes("json")) {
    return new Response(await obj.text(), { headers: noStore(base) });
  }
  return new Response(await obj.arrayBuffer(), { headers: noStore(base) });
}
