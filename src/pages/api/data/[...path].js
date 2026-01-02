// Edge API route that proxies R2 objects behind /data/*.
// This keeps client fetches same-origin and lets us use the R2 binding.
//
// Binding expected in Cloudflare Pages project settings / wrangler.toml:
//   LEADERBOARDS = <R2 bucket>

import { getRequestContext } from "@cloudflare/next-on-pages";

export const config = { runtime: "edge" };

const jsonHeaders = (extra = {}) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match, If-Modified-Since",
  "Cache-Control": "no-store",
  ...extra,
});

const binHeaders = (extra = {}) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "If-None-Match, If-Modified-Since",
  "Cache-Control": "no-store",
  ...extra,
});

function preflight() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, If-None-Match, If-Modified-Since",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function notFound(msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 404,
    headers: jsonHeaders(),
  });
}

async function serveFromR2(request, env, key) {
  if (!key || key.endsWith("/")) return notFound("Missing object key");

  const head = await env.LEADERBOARDS?.head(key);
  if (!head) return notFound(`No such object: ${key}`);

  const etag = head.httpEtag || head.etag || undefined;
  const lastMod = head.uploaded
    ? new Date(head.uploaded).toUTCString()
    : new Date().toUTCString();

  // Conditionals
  const inm = request.headers.get("If-None-Match");
  if (inm && etag && inm.replace(/^W\//, "") === etag.replace(/^W\//, "")) {
    return new Response(null, {
      status: 304,
      headers: binHeaders({ ETag: etag, "Last-Modified": lastMod }),
    });
  }

  const ims = request.headers.get("If-Modified-Since");
  if (ims && Date.parse(lastMod) <= Date.parse(ims)) {
    return new Response(null, {
      status: 304,
      headers: binHeaders({ ETag: etag, "Last-Modified": lastMod }),
    });
  }

  if (request.method === "HEAD") {
    return new Response(null, {
      headers: binHeaders({ ETag: etag, "Last-Modified": lastMod }),
    });
  }

  const obj = await env.LEADERBOARDS.get(key);
  if (!obj) return notFound(`No such object: ${key}`);

  const ctype = obj.httpMetadata?.contentType || "application/octet-stream";
  const base = { ETag: etag, "Last-Modified": lastMod, "Content-Type": ctype };

  if (ctype.includes("json")) {
    return new Response(await obj.text(), { headers: jsonHeaders(base) });
  }
  return new Response(await obj.arrayBuffer(), { headers: binHeaders(base) });
}

export default async function handler(request) {
  const { env } = getRequestContext();

  if (request.method === "OPTIONS") return preflight();
  if (!env?.LEADERBOARDS) {
    return new Response(
      JSON.stringify({ error: "Missing R2 binding: LEADERBOARDS" }),
      { status: 500, headers: jsonHeaders() }
    );
  }

  if (!(["GET", "HEAD"].includes(request.method))) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...binHeaders(), Allow: "GET, HEAD, OPTIONS" },
    });
  }

  // Next rewrite sends /data/<...> to /api/data/<...>
  const url = new URL(request.url);
  const apiPrefix = "/api/data/";
  const raw = url.pathname.startsWith(apiPrefix)
    ? url.pathname.slice(apiPrefix.length)
    : "";
  const key = decodeURIComponent(raw);

  return serveFromR2(request, env, key);
}
