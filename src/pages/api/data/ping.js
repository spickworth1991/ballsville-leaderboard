export const config = { runtime: "edge" };
export default async function handler() {
  return new Response("ok", { headers: { "Cache-Control": "no-store" } });
}
