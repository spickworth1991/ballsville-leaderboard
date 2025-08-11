const enc = new TextEncoder();
const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return crypto.subtle.sign("HMAC", key, enc.encode(data));
}

export async function createSessionCookie(env, username, ttlSeconds = 12 * 60 * 60) {
  const secretStr = env?.ADMIN_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!secretStr) throw new Error("ADMIN_SESSION_SECRET is not set");

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = JSON.stringify({ u: username, exp });
  const sig = await hmac(enc.encode(secretStr), payload);
  const value = `${b64u(enc.encode(payload))}.${b64u(sig)}`;

  return [
    `admin_session=${value}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
    `Path=/`,
    `Max-Age=${ttlSeconds}`,
  ].join("; ");
}

export async function verifySession(env, cookieHeader) {
  if (!cookieHeader) return null;
  const secretStr = env?.ADMIN_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!secretStr) return null;

  const m = /(?:^|;\s*)admin_session=([^;]+)/.exec(cookieHeader);
  if (!m) return null;
  const [payloadB64u, sigB64u] = m[1].split(".");
  if (!payloadB64u || !sigB64u) return null;

  const payloadJSON = atob(payloadB64u.replaceAll("-", "+").replaceAll("_", "/"));
  const payload = JSON.parse(payloadJSON);
  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;

  const expected = await hmac(enc.encode(secretStr), payloadJSON);
  if (b64u(expected) !== sigB64u) return null;

  return payload.u || null;
}
