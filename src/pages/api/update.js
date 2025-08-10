export const config = { runtime: 'edge' };
import { getRequestContext } from '@cloudflare/next-on-pages';


import { generateAll } from "../../lib/generate";
import { verifySession } from "../../lib/auth";

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifySession(env, request.headers.get("cookie") || "");
  if (!(user || (token && token === env.ADMIN_TOKEN))) return new Response("Unauthorized", { status: 401 });

  try {
    const logs = [];
    await generateAll(env, (m) => logs.push(m));
    await env.CONFIG_KV.put("last_run_ts", Date.now().toString());
    return new Response(JSON.stringify({ ok: true, logs }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
