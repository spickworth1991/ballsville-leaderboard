// functions/api/compact.js
import { compactOne } from "../_lib/compact.js";
import { verifySession } from "../_lib/auth.js";

export default async function handler(req, ctx) {
  const { env } = ctx;
  const url = new URL(req.url);
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Auth (cookie or bearer)
  const user = await verifySession(env, req.headers.get("cookie") || "");
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!(user || (token && token === env.ADMIN_TOKEN))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const year = String(body.year || "");
  const category = String(body.category || "");
  if (!year || !category) {
    return new Response(JSON.stringify({ ok:false, error:"Missing year/category" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const logs = [];
  const log = (m) => logs.push(m);
  try {
    const out = await compactOne(env, year, category, log);
    return new Response(JSON.stringify({ ok: true, logs, ...out }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    logs.push(String(e));
    return new Response(JSON.stringify({ ok: false, logs, error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
