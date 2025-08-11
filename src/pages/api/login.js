// src/pages/api/login.js
export const config = { runtime: 'edge' };

import { createSessionCookie, verifySession } from '../../lib/auth';

const present = (v) => (v ? true : false);

export default async function handler(req, ctx) {
  const { env } = ctx;
  const url = new URL(req.url);
  const method = req.method || 'GET';

  // --- Lightweight diagnostics (no secrets values, just booleans) ---
  if (method === 'GET' && url.searchParams.get('diag') === '1') {
    return new Response(
      JSON.stringify(
        {
          ADMIN_USER: present(env?.ADMIN_USER),
          ADMIN_PASS: present(env?.ADMIN_PASS),
          ADMIN_SESSION_SECRET: present(env?.ADMIN_SESSION_SECRET),
          // optional, if you use Bearer for admin tools:
          ADMIN_TOKEN: present(env?.ADMIN_TOKEN),
        },
        null,
        2
      ),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }

  if (method === 'HEAD') {
    // Just check the cookie-based session
    try {
      const ok = !!(await verifySession(env, req.headers.get('cookie') || ''));
      return new Response(null, { status: ok ? 200 : 401, headers: { 'Cache-Control': 'no-store' } });
    } catch {
      // If verifySession throws due to misconfig, report 500
      return new Response(null, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
  }

  if (method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Hard fail early if required env is missing
  if (!env?.ADMIN_USER || !env?.ADMIN_PASS || !env?.ADMIN_SESSION_SECRET) {
    return new Response('Server misconfiguration', {
      status: 500,
      headers: {
        // quick hints via headers too
        'X-Diag-Admin-User': present(env?.ADMIN_USER) ? 'yes' : 'no',
        'X-Diag-Admin-Pass': present(env?.ADMIN_PASS) ? 'yes' : 'no',
        'X-Diag-Admin-Secret': present(env?.ADMIN_SESSION_SECRET) ? 'yes' : 'no',
        'Cache-Control': 'no-store',
      },
    });
  }

  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) return new Response('Bad Request', { status: 400 });

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
}
