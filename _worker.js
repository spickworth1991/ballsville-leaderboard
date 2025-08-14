// _worker.js — minimal R2 reader (serves /data/*), everything else = static assets

function okJSON(body, extra = {}) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=59",
      "Access-Control-Allow-Origin": "*",
      ...extra,
    },
  });
}

function okBin(body, extra = {}) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=604800, immutable",
      "Access-Control-Allow-Origin": "*",
      ...extra,
    },
  });
}

// Simple CORS preflight for /data/*
function handleOptions(req) {
  const headers = req.headers;
  if (
    headers.get("Origin") !== null &&
    headers.get("Access-Control-Request-Method") !== null
  ) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": headers.get("Access-Control-Request-Headers") || "",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  return new Response(null, { headers: { Allow: "GET, HEAD, OPTIONS" } });
}

async function handleData(req, env) {
  if (!env?.LEADERBOARDS) return new Response("R2 not bound", { status: 500 });

  const url = new URL(req.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/data\/?/, ""));
  if (!key) return new Response("Not found", { status: 404 });

  const obj = await env.LEADERBOARDS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  const isJSON = key.endsWith(".json");
  return isJSON ? okJSON(obj.body) : okBin(obj.body);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/data/")) {
      if (req.method === "OPTIONS") return handleOptions(req);
      if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
      }
      return handleData(req, env);
    }

    // everything else -> static assets produced by next-on-pages
    return env.ASSETS.fetch(req, ctx);
  }
};
