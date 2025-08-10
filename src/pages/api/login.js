export const config = { runtime: 'edge' };

import { createSessionCookie } from '../../lib/auth';


export async function onRequestPost({ request, env }) {
  const { username, password } = await request.json().catch(() => ({}));
  if (!username || !password) return new Response("Bad Request", { status: 400 });

  if (username !== env.ADMIN_USER || password !== env.ADMIN_PASS) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid credentials" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  const cookie = await createSessionCookie(env, username);
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Set-Cookie": cookie,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
