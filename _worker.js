// _worker.js — Minimal Pages+R2 reader: serves /data/* from R2 and static assets from /public

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;

    // Serve any object stored in R2 at /data/<key>
    if (p.startsWith("/data/")) {
      if (!env?.LEADERBOARDS) {
        return new Response("R2 not bound", { status: 500 });
      }
      const key = decodeURIComponent(p.replace(/^\/data\/?/, ""));
      if (!key) return new Response("Not found", { status: 404 });

      const obj = await env.LEADERBOARDS.get(key);
      if (!obj) return new Response("Not found", { status: 404 });

      // Infer content type for JSON; default to octet-stream for anything else
      const isJSON = key.endsWith(".json");
      return new Response(obj.body, {
        headers: {
          "Content-Type": isJSON ? "application/json" : "application/octet-stream",
          "Cache-Control": isJSON
            ? "public, max-age=3600, stale-while-revalidate=59"
            : "public, max-age=604800, immutable",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Everything else → static assets (your /public folder)
    return env.ASSETS.fetch(req, ctx);
  },
};
