export const config = { runtime: "edge" };
export default function handler() {
  return new Response("ok", { headers: { "Cache-Control": "no-store" } });
}
