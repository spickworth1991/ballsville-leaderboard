import { verifySession } from "../_lib/auth";

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifySession(env, request.headers.get("cookie") || "");
  if (!(user || (token && token === env.ADMIN_TOKEN))) return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { hourUTC = 7, minuteUTC = 0, enabled = true } = body;
  await env.CONFIG_KV.put("schedule", JSON.stringify({ hourUTC, minuteUTC, enabled }));
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}
