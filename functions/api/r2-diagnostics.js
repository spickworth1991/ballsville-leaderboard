export const config = { runtime: 'edge' };

import { verifySession } from '../_lib/auth';

export default async function handler(req, ctx) {
  const { env } = ctx;

  const user = await verifySession(env, req.headers.get('cookie') || '');
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(user || (token && token === env.ADMIN_TOKEN))) return new Response('Unauthorized', { status: 401 });

  if (req.method === 'GET') {
    const listResp = await env.LEADERBOARDS.list({ limit: 50 });
    return new Response(JSON.stringify(listResp.objects, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method === 'POST') {
    const key = `test_${Date.now()}.txt`;
    const content = `This is a test file created at ${new Date().toISOString()}`;
    await env.LEADERBOARDS.put(key, content);
    const obj = await env.LEADERBOARDS.get(key);
    const body = obj ? await obj.text() : null;
    return new Response(JSON.stringify({ key, content: body }, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
