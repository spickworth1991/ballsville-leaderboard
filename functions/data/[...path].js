// functions/data/[...path].js
//
// R2 proxy for /data/*
//
// This replaces the old custom worker entrypoint approach.
// With next-on-pages (no custom entrypoint), Pages Functions handle /api/* and this file handles /data/*.
//
// Requires an R2 binding named LEADERBOARDS (see wrangler.toml).
//
// Supports: GET, HEAD, OPTIONS (CORS). Uses ETag + Last-Modified for conditional requests.

function jsonHeaders(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, If-None-Match, If-Modified-Since",
    "Cache-Control": "no-store",
    ...extra,
  };
}

function binHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "If-None-Match, If-Modified-Since",
    "Cache-Control": "no-store",
    ...extra,
  };
}

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

function methodNotAllowed() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, HEAD, OPTIONS" },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname || "";

  // CORS preflight
  if (request.method === "OPTIONS") return preflight();

  if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed();

  // Compute object key from /data/<key>
  const key = decodeURIComponent(pathname.replace(/^\/data\//, ""));
  if (!key || key.endsWith("/")) return notFound("Missing object key");

  const bucket = env.LEADERBOARDS;
  if (!bucket) {
    return new Response(JSON.stringify({ error: "Missing R2 binding: LEADERBOARDS" }), {
      status: 500,
      headers: jsonHeaders(),
    });
  }

  // HEAD to get metadata/etag
  const head = await bucket.head(key);
  if (!head) return notFound(`No such object: ${key}`);

  const etag = head.httpEtag || head.etag || undefined;
  const lastMod = head.uploaded ? new Date(head.uploaded).toUTCString() : new Date().toUTCString();

  // Conditionals
  const inm = request.headers.get("If-None-Match");
  if (inm && etag && inm.replace(/^W\//, "") === etag.replace(/^W\//, "")) {
    return new Response(null, { status: 304, headers: binHeaders({ ETag: etag, "Last-Modified": lastMod }) });
  }
  const ims = request.headers.get("If-Modified-Since");
  if (ims && Date.parse(lastMod) <= Date.parse(ims)) {
    return new Response(null, { status: 304, headers: binHeaders({ ETag: etag, "Last-Modified": lastMod }) });
  }

  if (request.method === "HEAD") {
    return new Response(null, { headers: binHeaders({ ETag: etag, "Last-Modified": lastMod }) });
  }

  const obj = await bucket.get(key);
  if (!obj) return notFound(`No such object: ${key}`);

  const ctype = obj.httpMetadata?.contentType || "application/octet-stream";
  const base = { ETag: etag, "Last-Modified": lastMod, "Content-Type": ctype };

  if (ctype.includes("json")) {
    return new Response(await obj.text(), { headers: jsonHeaders(base) });
  }
  return new Response(await obj.arrayBuffer(), { headers: binHeaders(base) });
}
