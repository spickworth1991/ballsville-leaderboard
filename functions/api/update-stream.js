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

        const logs = [];
        const { manifest, cursor, done } = await generateAll(
          env,
          (msg) => { logs.push(msg); send({ type: 'log', msg }); },
          isCanceled
        );

        // You can emit the manifest for this batch
        if (manifest && manifest.length) send({ type: 'manifest', manifest });

        // If we’re not done, tell the client to pause/reconnect (NOT an error)
        if (!done) {
          send({ type: 'pause' });
        } else {
          send({ type: 'done' });
        }
      } catch (e) {
        const s = String(e || '');
        // Treat our cooperative budget exit as a PAUSE, not an error
        if ((e && e.name === 'PAUSE') || s.includes('PAUSE')) {
          send({ type: 'pause' });
        } else if (s.includes('Canceled')) {
          send({ type: 'canceled' });
        } else {
          send({ type: 'error', error: s });
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
