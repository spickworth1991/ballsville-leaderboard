// functions/api/update-stream.js
import { generateAll } from '../_lib/generate.js';
import { verifySession } from '../_lib/auth.js';
import { createRun, endRun } from '../_lib/run-state.js';

const enc = new TextEncoder();
const line = (obj) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
const CURSOR_KEY = 'run_cursor_v1';

export default async function handler(req, ctx) {
  const { env } = ctx;
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  // auth (cookie or bearer)
  const user = await verifySession(env, req.headers.get('cookie') || '');
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(user || (token && token === env.ADMIN_TOKEN))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id, state } = createRun();
  const isCanceled = () => state.canceled === true;

  // load cursor from KV (persist between requests)
  let startCursor = null;
  try {
    const raw = await env.CONFIG_KV.get(CURSOR_KEY);
    if (raw) startCursor = JSON.parse(raw);
  } catch {}

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(line(obj));
      const heartbeat = setInterval(() => controller.enqueue(enc.encode(':hb\n\n')), 15000);

      try {
        send({ type: 'start', runId: id, at: Date.now() });

        const logs = [];
        const log = (msg) => { logs.push(msg); send({ type: 'log', msg }); };

        // IMPORTANT: one league per call — generateAll will respect this and return a cursor
        const { manifest, cursor, done } = await generateAll(env, log, isCanceled, startCursor);

        // write last-run + cursor
        await env.CONFIG_KV.put('last_run_ts', Date.now().toString());
        if (done || !cursor) {
          await env.CONFIG_KV.delete(CURSOR_KEY);
          send({ type: 'manifest', manifest });
          send({ type: 'done' });
        } else {
          await env.CONFIG_KV.put(CURSOR_KEY, JSON.stringify(cursor));
          send({ type: 'manifest', manifest });
          // tell client to reconnect immediately for the next league
          send({ type: 'pause', note: 'batch complete; reconnecting' });
        }
      } catch (e) {
        const s = String(e);
        send({ type: 'error', error: s });
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
