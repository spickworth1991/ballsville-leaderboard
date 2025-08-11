// src/pages/api/login.js
export const config = { runtime: 'edge' };

import { createSessionCookie, verifySession } from '../../lib/auth';

export default async function handler(req, ctx) {
  const { env } = ctx;
  const method = req.method || 'GET';

  if (method === 'HEAD') {
    const ok = !!(await verifySession(env, req.headers.get('cookie') || ''));
    return new Response(null, { status: ok ? 200 : 401, headers: { 'Cache-Control': 'no-store' } });
  }

  if (method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) return new Response('Bad Request', { status: 400 });

  if (username !== env.ADMIN_USER || password !== env.ADMIN_PASS) {
    return new Response(JSON.stringify({ ok: false }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const cookie = await createSessionCookie(env, username);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Set-Cookie': cookie, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
