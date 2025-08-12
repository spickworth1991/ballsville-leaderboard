// functions/api/login.js

export async function onRequestHead({ request, env }) {
  return verifySessionResponse(env, request.headers.get('cookie') || '');
}

export async function onRequestPost({ request, env }) {
  // sanity check; helps if env vars are missing
  if (!env.ADMIN_USER || !env.ADMIN_PASS || !env.ADMIN_SESSION_SECRET) {
    return new Response(
      'Server misconfigured: missing ADMIN_USER/ADMIN_PASS/ADMIN_SESSION_SECRET',
      { status: 500 }
    );
  }

  const { username, password } = await request.json().catch(() => ({}));
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

/* ---------- helpers (edge-safe) ---------- */

const enc = new TextEncoder();

function b64uEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function b64uDecodeToUint8(str) {
  const pad = str.length % 4 === 2 ? '==' : str.length % 4 === 3 ? '=' : '';
  const b64 = str.replaceAll('-', '+').replaceAll('_', '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
  const payloadJson = JSON.stringify({ u: username, exp });
  const secret = enc.encode(env.ADMIN_SESSION_SECRET || '');
  const sigBuf = await hmacSha256(secret, enc.encode(payloadJson));
  const value = `${b64uEncode(enc.encode(payloadJson))}.${b64uEncode(sigBuf)}`;
  return [
    `admin_session=${value}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
    `Path=/`,
    `Max-Age=${ttlSeconds}`
  ].join('; ');
}

async function verifySession(env, cookieHeader) {
  if (!cookieHeader) return null;
  const m = /(?:^|;\s*)admin_session=([^;]+)/.exec(cookieHeader);
  if (!m) return null;
  const token = m[1];
  const [payloadB64u, sigB64u] = token.split('.');
  if (!payloadB64u || !sigB64u) return null;

  const payloadBytes = b64uDecodeToUint8(payloadB64u);
  const payloadJson = new TextDecoder().decode(payloadBytes);
  let payload;
  try { payload = JSON.parse(payloadJson); } catch { return null; }
  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;

  const secret = enc.encode(env.ADMIN_SESSION_SECRET || '');
  const expected = await hmacSha256(secret, enc.encode(payloadJson));
  if (b64uEncode(expected) !== sigB64u) return null;

  return payload.u || null;
}

async function verifySessionResponse(env, cookieHeader) {
  const ok = !!(await verifySession(env, cookieHeader));
  return new Response(null, { status: ok ? 200 : 401, headers: { 'Cache-Control': 'no-store' } });
}
