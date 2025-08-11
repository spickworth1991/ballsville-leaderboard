export const config = { runtime: 'edge' };

// Serve R2 objects at /data/<key>
export default async function handler(req, ctx) {
  const { env } = ctx;
  if (!env?.LEADERBOARDS) return new Response("R2 not bound", { status: 500 });

  // Extract everything after `/data/`
  const url = new URL(req.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/data\/?/, ""));
  if (!key) return new Response("Not found", { status: 404 });

  const obj = await env.LEADERBOARDS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

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
