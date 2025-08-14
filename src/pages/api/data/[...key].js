// pages/api/data/[...key].js
import { getRequestContext } from "@cloudflare/next-on-pages";

export const config = { runtime: "edge" };

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
  try {
    const url = new URL(req.url);
    let key = url.pathname.replace(/^\/api\/data\//, "");
    if (key === "leaderboard.json") key = "leaderboards.json"; // alias

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: noStore({ "Access-Control-Max-Age": "86400", "X-Debug":"options" }) });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
    }
    if (!key || key.endsWith("/")) {
      return new Response(JSON.stringify({ error: "Missing object key" }), {
        status: 404,
        headers: noStore({ "Content-Type": "application/json; charset=utf-8", "X-Debug-Key": key || "<empty>" }),
      });
    }

    const { env } = getRequestContext();
    const bucket = env?.LEADERBOARDS;
    if (!bucket) {
      return new Response(JSON.stringify({ error: "Missing R2 binding LEADERBOARDS" }), {
        status: 500,
        headers: noStore({ "Content-Type": "application/json; charset=utf-8", "X-Debug-Binding": "MISSING" }),
      });
    }

    const head = await bucket.head(key);
    if (!head) {
      return new Response(JSON.stringify({ error: `No such object: ${key}` }), {
        status: 404,
        headers: noStore({ "Content-Type": "application/json; charset=utf-8", "X-Debug-Key": key, "X-Debug-Binding": "PRESENT" }),
      });
    }

    const etag = head.httpEtag || head.etag || "";
    const lastMod = head.uploaded ? new Date(head.uploaded).toUTCString() : new Date().toUTCString();

    // Conditionals
    const inm = req.headers.get("If-None-Match");
    if (inm && etag && inm.replace(/^W\//, "") === etag.replace(/^W\//, "")) {
      return new Response(null, { status: 304, headers: noStore({ ETag: etag, "Last-Modified": lastMod, "X-Debug-Key": key }) });
    }
    const ims = req.headers.get("If-Modified-Since");
    if (ims && !Number.isNaN(Date.parse(ims)) && Date.parse(lastMod) <= Date.parse(ims)) {
      return new Response(null, { status: 304, headers: noStore({ ETag: etag, "Last-Modified": lastMod, "X-Debug-Key": key }) });
    }

    if (req.method === "HEAD") {
      return new Response(null, { headers: noStore({ ETag: etag, "Last-Modified": lastMod, "X-Debug-Key": key }) });
    }

    const obj = await bucket.get(key);
    if (!obj) {
      return new Response(JSON.stringify({ error: `No such object on get(): ${key}` }), {
        status: 404,
        headers: noStore({ "Content-Type": "application/json; charset=utf-8", "X-Debug-Key": key }),
      });
    }

    const ctype = obj.httpMetadata?.contentType || "application/octet-stream";
    const base = { ETag: etag, "Last-Modified": lastMod, "Content-Type": ctype, "X-Debug-Key": key, "X-Debug-Binding": "PRESENT" };

    if (ctype.includes("json")) {
      return new Response(await obj.text(), { headers: noStore(base) });
    }
    return new Response(await obj.arrayBuffer(), { headers: noStore(base) });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 500,
      headers: noStore({ "Content-Type": "application/json; charset=utf-8", "X-Debug": "exception" }),
    });
  }
}
