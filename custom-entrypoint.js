import nextOnPagesHandler from "@cloudflare/next-on-pages/fetch-handler";

// Shared headers
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
const preflight = () =>
  new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, If-None-Match, If-Modified-Since",
      "Access-Control-Max-Age": "86400",
    },
  });

const notFound = (msg) =>
  new Response(JSON.stringify({ error: msg }), { status: 404, headers: jsonHeaders() });

async function serveR2(request, env) {
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/data\//, ""));
  if (!key || key.endsWith("/")) return notFound("Missing object key");

  // HEAD first to get metadata/etag
  const head = await env.LEADERBOARDS.head(key);
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

  const obj = await env.LEADERBOARDS.get(key);
  if (!obj) return notFound(`No such object: ${key}`);

  const ctype = obj.httpMetadata?.contentType || "application/octet-stream";
  const base = { ETag: etag, "Last-Modified": lastMod, "Content-Type": ctype };

  if (ctype.includes("json")) {
    return new Response(await obj.text(), { headers: jsonHeaders(base) });
  }
  return new Response(await obj.arrayBuffer(), { headers: binHeaders(base) });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // CORS preflight for /data/*
    if (pathname.startsWith("/data/") && request.method === "OPTIONS") {
      return preflight();
    }
    // Only /data/* is handled here; everything else goes to Next
    if (pathname.startsWith("/data/")) {
      if (!["GET", "HEAD"].includes(request.method)) {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
      }
      return serveR2(request, env);
    }

    // Hand off to Next.js (SSR, static, the rest)
    return nextOnPagesHandler.fetch(request, env, ctx);
  },
};
