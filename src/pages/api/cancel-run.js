import { getRun, cancelRun } from '../../lib/run-state';
import { verifySession } from '../../lib/auth';

export async function onRequestPost({ request, env }) {
  const user = await verifySession(env, request.headers.get("cookie") || "");
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!(user || (token && token === env.ADMIN_TOKEN))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { runId } = await request.json().catch(() => ({}));
  if (!runId) return new Response("Bad Request", { status: 400 });

  const exists = !!getRun(runId);
  const ok = cancelRun(runId);
  return new Response(JSON.stringify({ ok, existed: exists }), {
    headers: { "Content-Type": "application/json" },
  });
}
