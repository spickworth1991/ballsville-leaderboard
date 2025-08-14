// functions/api/update-stream.js
import { generateAll } from '../_lib/generate.js';
import { verifySession } from '../_lib/auth.js';
import { createRun, endRun } from '../_lib/run-state.js';

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

        const { cursor, done, rotate } = await generateAll(
          env,
          (msg) => { send({ type: 'log', msg }); },
          isCanceled
        );

        if (done) {
          send({ type: 'done' });
        } else if (rotate) {
          // hard rotate: client should close & reconnect
          send({ type: 'rotate' });
        } else {
          // fallback (shouldn’t normally hit now)
          send({ type: 'rotate' });
        }
      } catch (e) {
        const s = String(e || '');
        if (e && (e.name === 'ROTATE' || s.includes('ROTATE'))) {
          // cooperative rotate signal from generator
          controller.enqueue(line({ type: 'rotate' }));
        } else if (s.includes('Canceled')) {
          controller.enqueue(line({ type: 'canceled' }));
        } else {
          controller.enqueue(line({ type: 'error', error: s }));
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
