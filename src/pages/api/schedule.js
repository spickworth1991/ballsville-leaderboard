export const config = { runtime: 'edge' };

import { verifySession } from '../../../functions/_lib/auth';

// GET current schedule
export default async function handler(req, ctx) {
  const { env } = ctx;

  if (req.method === 'GET') {
    const raw = await env.CONFIG_KV.get("schedule");
    const fallback = { hourUTC: 7, minuteUTC: 0, enabled: true };
    return new Response(raw ?? JSON.stringify(fallback), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }

  if (req.method === 'POST') {
    const user = await verifySession(env, req.headers.get('cookie') || '');
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!(user || (token && token === env.ADMIN_TOKEN))) return new Response('Unauthorized', { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body) return new Response("Bad Request", { status: 400 });

    const hour = Math.max(0, Math.min(23, Number(body.hourUTC ?? 7) | 0));
    const minute = Math.max(0, Math.min(59, Number(body.minuteUTC ?? 0) | 0));
    const enabled = !!body.enabled;

    await env.CONFIG_KV.put("schedule", JSON.stringify({ hourUTC: hour, minuteUTC: minute, enabled }));
    return new Response("OK", { status: 200 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
