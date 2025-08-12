// functions/api/login.js
import { createSessionCookie, verifySession } from '../_lib/auth';

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method || 'GET';

  // Session check used by the admin page
  if (method === 'HEAD') {
    const ok = !!(await verifySession(env, request.headers.get('cookie') || ''));
    return new Response(null, { status: ok ? 200 : 401, headers: { 'Cache-Control': 'no-store' } });
  }

  if (method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body = {};
  try { body = await request.json(); } catch {}
  const { username, password } = body;
  if (!username || !password) return new Response('Bad Request', { status: 400 });

  if (username !== env.ADMIN_USER || password !== env.ADMIN_PASS) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const cookie = await createSessionCookie(env, username);
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Set-Cookie': cookie,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}
