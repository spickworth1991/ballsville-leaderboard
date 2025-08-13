// functions/api/cancel-run.js
import { getRun, cancelRun } from '../_lib/run-state.js';
import { verifySession } from '../_lib/auth.js';

const CURSOR_KEY = 'run_cursor_v1';

export default async function handler(req, ctx) {
  const { env } = ctx;
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const user = await verifySession(env, req.headers.get('cookie') || '');
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(user || (token && token === env.ADMIN_TOKEN))) return new Response('Unauthorized', { status: 401 });

  const { runId } = await req.json().catch(() => ({}));
  if (!runId) return new Response('Bad Request', { status: 400 });

  const existed = !!getRun(runId);
  const ok = cancelRun(runId);

  // Also clear the persisted cursor so a future Live run starts from scratch.
  try { await env.CONFIG_KV.delete(CURSOR_KEY); } catch {}

  return new Response(JSON.stringify({ ok, existed }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
