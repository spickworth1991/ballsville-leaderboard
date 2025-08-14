// _worker.js — R2-only reader for /data/* and static assets

async function handleData(req, env) {
  if (!env?.LEADERBOARDS) return new Response("R2 not bound", { status: 500 });
  const url = new URL(req.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/data\/?/, ""));
  if (!key) return new Response("Not found", { status: 404 });

  const obj = await env.LEADERBOARDS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  const isJSON = key.endsWith(".json");
  return new Response(obj.body, {
    headers: {
      "Content-Type": isJSON ? "application/json" : "application/octet-stream",
      "Cache-Control": isJSON ? "public, max-age=3600, stale-while-revalidate=59" : "public, max-age=604800, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/data/")) return handleData(req, env);

    // everything else -> static assets produced by next-on-pages
    return env.ASSETS.fetch(req, ctx);
  }
};
