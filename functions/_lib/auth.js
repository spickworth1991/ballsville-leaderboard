const enc = new TextEncoder();
const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return crypto.subtle.sign("HMAC", key, enc.encode(data));
}

export async function createSessionCookie(env, username, ttlSeconds = 12 * 60 * 60) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = JSON.stringify({ u: username, exp });
  const secret = enc.encode(env.ADMIN_SESSION_SECRET || "");
  const sig = await hmac(secret, payload);
  const value = `${b64u(enc.encode(payload))}.${b64u(sig)}`;
  const cookie = [
    `admin_session=${value}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
    `Path=/`,
    `Max-Age=${ttlSeconds}`
  ].join("; ");
  return cookie;
}

export async function verifySession(env, cookieHeader) {
  if (!cookieHeader) return null;
  const m = /(?:^|;\s*)admin_session=([^;]+)/.exec(cookieHeader);
  if (!m) return null;
  const token = m[1];
  const [payloadB64u, sigB64u] = token.split(".");
  if (!payloadB64u || !sigB64u) return null;

  const payloadJSON = atob(payloadB64u.replaceAll("-", "+").replaceAll("_", "/"));
  const payload = JSON.parse(payloadJSON);
  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;

  const secret = new TextEncoder().encode(env.ADMIN_SESSION_SECRET || "");
  const expected = await hmac(secret, payloadJSON);
  const expectedB64u = b64u(expected);
  if (expectedB64u !== sigB64u) return null;

  return payload.u || null;
}

export function okOrUnauthorized(isAuthed) {
  if (isAuthed) return null;
  return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
}
