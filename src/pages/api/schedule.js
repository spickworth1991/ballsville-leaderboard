export const config = { runtime: 'edge' };
import { getRequestContext } from '@cloudflare/next-on-pages';


// GET returns the current schedule from KV
export async function onRequestGet({ env }) {
  const { env } = getRequestContext();

  const raw = await env.CONFIG_KV.get("schedule");
  const fallback = { hourUTC: 7, minuteUTC: 0, enabled: true };
  return new Response(raw ?? JSON.stringify(fallback), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

// POST saves a new schedule to KV (auth: cookie "admin=1" OR Bearer ADMIN_TOKEN)
export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("authorization") || "";
  const { env } = getRequestContext();

  const cookie = request.headers.get("cookie") || "";
  const hasCookie = /\badmin=1\b/.test(cookie);
  const hasBearer = env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`;
  if (!hasCookie && !hasBearer) return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return new Response("Bad Request", { status: 400 });

  // Validate & clamp
  const hour = Math.max(0, Math.min(23, Number(body.hourUTC ?? 7) | 0));
  const minute = Math.max(0, Math.min(59, Number(body.minuteUTC ?? 0) | 0));
  const enabled = !!body.enabled;

  await env.CONFIG_KV.put("schedule", JSON.stringify({ hourUTC: hour, minuteUTC: minute, enabled }));

  return new Response("OK", { status: 200 });
}
