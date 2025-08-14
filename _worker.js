// _worker.js — R2 proxy for /data/* with proper caching + ETags

function withJSONHeaders(init = {}) {
  return {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, If-None-Match, If-Modified-Since",
      // Make updates visible immediately in browsers:
      "Cache-Control": "no-store",
      ...init.headers,
    },
    status: init.status || 200,
  };
}

function withBinHeaders(init = {}) {
  return {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "If-None-Match, If-Modified-Since",
      "Cache-Control": "no-store",
      ...init.headers,
    },
    status: init.status || 200,
  };
}

function notFoundJSON(message = "Not Found") {
  return new Response(JSON.stringify({ error: message }), withJSONHeaders({ status: 404 }));
}

function methodNotAllowed() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
}

function handleOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, If-None-Match, If-Modified-Since",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/**
 * Read an object from R2 and respond with ETag/Last-Modified.
 * Supports HEAD and conditional GET (If-None-Match / If-Modified-Since).
 */
async function handleData(req, env) {
  const url = new URL(req.url);
  // /data/<key>
  const key = url.pathname.replace(/^\/data\//, "");
  if (!key || key.endsWith("/")) return notFoundJSON("Missing object key");

  // Fetch object metadata first for conditional checks
  const head = await env.LEADERBOARDS.head(key);
  if (!head) return notFoundJSON(`No such object: ${key}`);

  const etag = head.httpEtag || head.etag || undefined;
  const lastModified = head.uploaded?.toUTCString?.() || new Date(head.uploaded || Date.now()).toUTCString();

  // Conditional requests
  const inm = req.headers.get("If-None-Match");
  if (inm && etag && inm.replace(/W\//, "") === etag.replace(/W\//, "")) {
    return new Response(null, withBinHeaders({ status: 304, headers: { ETag: etag, "Last-Modified": lastModified } }));
  }
  const ims = req.headers.get("If-Modified-Since");
  if (ims) {
    const imsTime = Date.parse(ims);
    const objTime = Date.parse(lastModified);
    if (!isNaN(imsTime) && !isNaN(objTime) && objTime <= imsTime) {
      return new Response(null, withBinHeaders({ status: 304, headers: { ETag: etag, "Last-Modified": lastModified } }));
    }
  }

  if (req.method === "HEAD") {
    // No body, only headers
    return new Response(null, withBinHeaders({ headers: { ETag: etag, "Last-Modified": lastModified } }));
  }

  // GET body
  const object = await env.LEADERBOARDS.get(key);
  if (!object) return notFoundJSON(`No such object: ${key}`);

  const headers = { ETag: etag, "Last-Modified": lastModified };
  const ctype = object.httpMetadata?.contentType || "application/octet-stream";

  if (ctype.includes("json")) {
    return new Response(await object.text(), withJSONHeaders({ headers }));
  }
  return new Response(await object.arrayBuffer(), withBinHeaders({ headers: { ...headers, "Content-Type": ctype } }));
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/data/")) {
      if (req.method === "OPTIONS") return handleOptions();
      if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed();
      return handleData(req, env);
    }

    // Everything else: serve static assets produced by Pages
    return env.ASSETS.fetch(req, ctx);
  },
};
