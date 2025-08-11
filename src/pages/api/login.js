// src/pages/api/login.js
export const config = { runtime: 'edge' };

/** ----- tiny helpers, all edge-safe (no Node imports) ----- **/

const enc = new TextEncoder();

function b64uEncode(buf) {
  // base64url encode a Uint8Array
  let str = '';
  const bytes = new Uint8Array(buf);
  const bin = Array.from(bytes, b => String.fromCharCode(b)).join('');
  str = btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return str;
}

function b64uDecodeToUint8(str) {
  const pad = str.length % 4 === 2 ? '==' : str.length % 4 === 3 ? '=' : '';
  const b64 = str.replaceAll('-', '+').replaceAll('_', '/') + pad;
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  return crypto.subtle.sign('HMAC', key, dataBytes);
}

async function createSessionCookie(env, username, ttlSeconds = 12 * 60 * 60) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payloadObj = { u: username, exp };
  const payloadJson = JSON.stringify(payloadObj);
  const secret = enc.encode(env.ADMIN_SESSION_SECRET || '');
  const sigBuf = await hmacSha256(secret, enc.encode(payloadJson));

  const value = `${b64uEncode(enc.encode(payloadJson))}.${b64uEncode(sigBuf)}`;
  const cookie = [
    `admin_session=${value}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
    `Path=/`,
    `Max-Age=${ttlSeconds}`,
  ].join('; ');
  return cookie;
}

async function verifySession(env, cookieHeader) {
  if (!cookieHeader) return null;
  const m = /(?:^|;\s*)admin_session=([^;]+)/.exec(cookieHeader);
  if (!m) return null;
  const token = m[1];
  const [payloadB64u, sigB64u] = token.split('.');
  if (!payloadB64u || !sigB64u) return null;

  // decode payload
  const payloadBytes = b64uDecodeToUint8(payloadB64u);
  const payloadJson = new TextDecoder().decode(payloadBytes);
  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;

  // verify signature
  const secret = enc.encode(env.ADMIN_SESSION_SECRET || '');
  const expected = await hmacSha256(secret, enc.encode(payloadJson));
  const expectedB64u = b64uEncode(expected);
  if (expectedB64u !== sigB64u) return null;

  return payload.u || null;
}

/** ----- handler (no imports) ----- **/

export default async function handler(req, ctx) {
  const { env } = ctx;
  const method = req.method || 'GET';

  // HEAD = session check
  if (method === 'HEAD') {
    const ok = !!(await verifySession(env, req.headers.get('cookie') || ''));
    return new Response(null, {
      status: ok ? 200 : 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Quick sanity check (helps catch empty envs)
  if (!env.ADMIN_USER || !env.ADMIN_PASS || !env.ADMIN_SESSION_SECRET) {
    return new Response(
      'Server misconfigured: missing ADMIN_USER/ADMIN_PASS/ADMIN_SESSION_SECRET',
      { status: 500 }
    );
  }

  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) return new Response('Bad Request', { status: 400 });

  if (username !== env.ADMIN_USER || password !== env.ADMIN_PASS) {
    return new Response(JSON.stringify({ ok: false }), {
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
