// functions/data/[[key]].js
export async function onRequestGet(context) {
  const { LEADERBOARDS } = context.env;

  // With [[key]].js the remaining path is a single string, e.g. "leaderboards.json"
  const key = context.params.key || ""; // '' if /data/ requested directly

  if (!key) {
    return new Response("Not found", { status: 404 });
  }

  // R2 returns an object with a .body stream
  const obj = await LEADERBOARDS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  const isJSON = key.endsWith(".json");
  return new Response(obj.body, {
    headers: {
      "Content-Type": isJSON ? "application/json" : "application/octet-stream",
      "Cache-Control": isJSON
        ? "public, max-age=3600, stale-while-revalidate=59"
        : "public, max-age=604800, immutable",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
