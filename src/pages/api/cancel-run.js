export const config = { runtime: 'edge' };

import { getRun, cancelRun } from '../../lib/run-state';
import { verifySession } from '../../../functions/_lib/auth';

export default async function handler(req, ctx) {
  const { env } = ctx;
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const user = await verifySession(env, req.headers.get('cookie') || '');
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(user || (token && token === env.ADMIN_TOKEN))) return new Response('Unauthorized', { status: 401 });

  const { runId } = await req.json().catch(() => ({}));
  if (!runId) return new Response('Bad Request', { status: 400 });

  const exists = !!getRun(runId);
  const ok = cancelRun(runId);
  return new Response(JSON.stringify({ ok, existed: exists }), { headers: { 'Content-Type': 'application/json' } });
}
