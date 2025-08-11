// src/pages/api/login.js
export const config = { runtime: 'edge' };

import { createSessionCookie, verifySession } from '../../lib/auth';

function mask(v) {
  if (!v) return '(unset)';
  const s = String(v);
  if (s.length <= 4) return '****';
  return s.slice(0, 2) + '****' + s.slice(-2);
}

export default async function handler(req, ctx) {
  const { env } = ctx;
  const method = req.method || 'GET';

  try {
    if (method === 'HEAD') {
      const ok = !!(await verifySession(env, req.headers.get('cookie') || ''));
      console.log('[login] HEAD check ->', ok ? 'OK (200)' : 'NO SESSION (401)');
      return new Response(null, {
        status: ok ? 200 : 401,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Log which env vars are present (masked)
    console.log('[login] ENV presence', {
      ADMIN_USER: mask(env?.ADMIN_USER),
      ADMIN_PASS: mask(env?.ADMIN_PASS),
      ADMIN_SESSION_SECRET: mask(env?.ADMIN_SESSION_SECRET),
    });

    const { username, password } = await req.json().catch(() => ({}));
    if (!username || !password) {
      console.log('[login] Missing creds in body');
      return new Response('Bad Request', { status: 400 });
    }

    const matchUser = username === env?.ADMIN_USER;
    const matchPass = password === env?.ADMIN_PASS;

    if (!matchUser || !matchPass) {
      console.log('[login] Invalid credentials', {
        gotUser: username,
        expUser: env?.ADMIN_USER ? '(set)' : '(unset)',
        userMatch: matchUser,
        passMatch: matchPass ? 'yes' : 'no',
      });
      return new Response(JSON.stringify({ ok: false, error: 'invalid' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!env?.ADMIN_SESSION_SECRET) {
      console.log('[login] ERROR: ADMIN_SESSION_SECRET is not set');
      return new Response('Server misconfiguration', { status: 500 });
    }

    const cookie = await createSessionCookie(env, username);

    console.log('[login] Success -> issuing session cookie');
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Set-Cookie': cookie,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.log('[login] Unhandled error:', String(err));
    return new Response('Internal Server Error', { status: 500 });
  }
}
