// _worker.js
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
const notFound = (msg) =>
  new Response(JSON.stringify({ error: msg }), { status: 404, headers: jsonHeaders() });

const opts = () =>
  new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, If-None-Match, If-Modified-Since",
      "Access-Control-Max-Age": "86400",
    },
  });

async function handleData(req, env) {
  const url = new URL(req.url);
  const key = url.pathname.replace(/^\/data\//, "");
  if (!key || key.endsWith("/")) return notFound("Missing object key");

  const head = await env.LEADERBOARDS.head(key);
  if (!head) return notFound(`No such object: ${key}`);

  const etag = head.httpEtag || head.etag || undefined;
  const lastMod =
    (head.uploaded && new Date(head.uploaded).toUTCString()) ||
    new Date().toUTCString();

  // Conditional: If-None-Match
  const inm = req.headers.get("If-None-Match");
  if (inm && etag && inm.replace(/^W\//, "") === etag.replace(/^W\//, "")) {
    return new Response(null, {
      status: 304,
      headers: binHeaders({ ETag: etag, "Last-Modified": lastMod }),
    });
  }
  // Conditional: If-Modified-Since
  const ims = req.headers.get("If-Modified-Since");
  if (ims && Date.parse(lastMod) <= Date.parse(ims)) {
    return new Response(null, {
      status: 304,
      headers: binHeaders({ ETag: etag, "Last-Modified": lastMod }),
    });
  }

  if (req.method === "HEAD") {
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

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/data/")) {
      if (req.method === "OPTIONS") return opts();
      if (!["GET", "HEAD"].includes(req.method))
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD, OPTIONS" },
        });
      return handleData(req, env);
    }

    // Everything else: static assets from Pages
    return env.ASSETS.fetch(req, ctx);
  },
};
