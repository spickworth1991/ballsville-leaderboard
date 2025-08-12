
import { generateAll } from '../_lib/generate.js';
import { verifySession } from '../_lib/auth.js';

export default async function handler(req, ctx) {
  const { env } = ctx;
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const user = await verifySession(env, req.headers.get('cookie') || '');
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(user || (token && token === env.ADMIN_TOKEN))) return new Response('Unauthorized', { status: 401 });

  try {
    const logs = [];
    const { manifest } = await generateAll(env, (m) => logs.push(m));
    await env.CONFIG_KV.put('last_run_ts', Date.now().toString());
    return new Response(JSON.stringify({ ok: true, logs, manifest }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
