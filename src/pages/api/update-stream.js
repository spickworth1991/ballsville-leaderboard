export const config = { runtime: 'edge' };

import { generateAll } from '../../lib/generate';
import { verifySession } from '../../lib/auth';
import { createRun, endRun } from '../../lib/run-state';

const enc = new TextEncoder();
const line = (obj) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

export default async function handler(req, ctx) {
  const { env } = ctx;

  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  // Auth (cookie or bearer)
  const user = await verifySession(env, req.headers.get('cookie') || '');
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(user || (token && token === env.ADMIN_TOKEN))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id, state } = createRun();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(line(obj));
      const heartbeat = setInterval(() => controller.enqueue(enc.encode(':hb\n\n')), 15000);
      const isCanceled = () => state.canceled === true;

      try {
        send({ type: 'start', runId: id, at: Date.now() });

        const logs = [];
        const { manifest } = await generateAll(
          env,
          (msg) => {
            logs.push(msg);
            send({ type: 'log', msg });
          },
          isCanceled
        );

        await env.CONFIG_KV.put('last_run_ts', Date.now().toString());
        send({ type: 'manifest', manifest });
        send({ type: 'done' });
      } catch (e) {
        if (String(e).includes('Canceled')) {
          send({ type: 'canceled' });
        } else {
          send({ type: 'error', error: String(e) });
        }
      } finally {
        clearInterval(heartbeat);
        endRun(id);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
