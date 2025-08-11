// src/pages/api/login.js
export const config = { runtime: 'edge' };

import { createSessionCookie, verifySession } from '../../lib/auth';

function present(v) { return v ? 'yes' : 'no'; }

export default async function handler(req, ctx) {
  const { env } = ctx;
  const method = req.method || 'GET';

  try {
    if (method === 'HEAD') {
      const ok = !!(await verifySession(env, req.headers.get('cookie') || ''));
      return new Response(null, {
        status: ok ? 200 : 401,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    // Hard fail early if required env is missing
    const missing = [];
    if (!env?.ADMIN_USER) missing.push('ADMIN_USER');
    if (!env?.ADMIN_PASS) missing.push('ADMIN_PASS');
    if (!env?.ADMIN_SESSION_SECRET) missing.push('ADMIN_SESSION_SECRET');

    if (missing.length) {
      return new Response('Server misconfiguration', {
        status: 500,
        headers: {
          'X-Diag-Admin-User': present(env?.ADMIN_USER),
          'X-Diag-Admin-Pass': present(env?.ADMIN_PASS),
          'X-Diag-Admin-Secret': present(env?.ADMIN_SESSION_SECRET),
          'Cache-Control': 'no-store',
        },
      });
    }

    const { username, password } = await req.json().catch(() => ({}));
    if (!username || !password) {
      return new Response('Bad Request', { status: 400 });
    }

    if (username !== env.ADMIN_USER || password !== env.ADMIN_PASS) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cookie = await createSessionCookie(env, username);
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Set-Cookie': cookie,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return new Response('Internal Server Error', { status: 500 });
  }
}
