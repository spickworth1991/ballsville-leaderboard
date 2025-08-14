// _worker.js — single-worker router for Pages + API + R2

import { createSessionCookie, verifySession } from "./auth.js";
import { generateAll } from "./generate.js";

// simple in-memory registry for live runs (per isolate)
const runs = new Map();
function createRun() { const id = crypto.randomUUID(); const s = { canceled:false }; runs.set(id, s); return { id, state:s }; }
function getRun(id) { return runs.get(id) || null; }
function cancelRun(id) { const s = runs.get(id); if (s) s.canceled = true; return !!s; }
function endRun(id) { runs.delete(id); }

const enc = new TextEncoder();
const sseLine = (obj) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

function isAuthed(req, env, cookieOkOnly = false) {
  // cookie session
  const cookieHeader = req.headers.get("cookie") || "";
  return verifySession(env, cookieHeader).then((u) => {
    if (u) return true;
    if (cookieOkOnly) return false;
    // bearer token fallback
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    return !!(token && token === env.ADMIN_TOKEN);
  });
}

async function handleLogin(req, env) {
  if (req.method === "HEAD") {
    const ok = !!(await verifySession(env, req.headers.get("cookie") || ""));
    return new Response(null, { status: ok ? 200 : 401, headers: { "Cache-Control": "no-store" } });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body = {};
  try { body = await req.json(); } catch {}
  const { username, password } = body;
  if (!username || !password) return new Response("Bad Request", { status: 400 });

  if (username !== env.ADMIN_USER || password !== env.ADMIN_PASS) {
    return new Response(JSON.stringify({ ok: false }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const cookie = await createSessionCookie(env, username);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Set-Cookie": cookie, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function handleUpdate(req, env) {
  if (!(await isAuthed(req, env))) return new Response("Unauthorized", { status: 401 });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const logs = [];
    const { manifest } = await generateAll(env, (m) => logs.push(m));
    await env.CONFIG_KV.put("last_run_ts", Date.now().toString());
    return new Response(JSON.stringify({ ok: true, logs, manifest }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

async function handleUpdateStream(req, env) {
  if (!(await isAuthed(req, env))) return new Response("Unauthorized", { status: 401 });
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const { id, state } = createRun();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(sseLine(obj));
      const heartbeat = setInterval(() => controller.enqueue(enc.encode(":hb\n\n")), 15000);
      const isCanceled = () => state.canceled === true;

      try {
        send({ type: "start", runId: id, at: Date.now() });

        const logs = [];
        // IMPORTANT: generateAll must write to R2 *as it goes* and advance the cursor in KV.
        // It should throw e.name === "PAUSE" when the subrequest budget is reached.
        const { manifest, done } = await generateAll(
          env,
          (msg) => { logs.push(msg); send({ type: "log", msg }); },
          isCanceled
        );

        await env.CONFIG_KV.put("last_run_ts", Date.now().toString());
        if (manifest && manifest.length) send({ type: "manifest", manifest });

        // If not finished, we *rotate* (tell client to reconnect) instead of “done”.
        if (!done) {
          send({ type: "rotate" });
        } else {
          send({ type: "done" });
        }
      } catch (e) {
        const s = String(e || "");
        // Treat generator’s PAUSE as a soft-rotate
        if ((e && e.name === "PAUSE") || s.includes("PAUSE")) {
          send({ type: "rotate" });
        } else if (s.includes("Canceled")) {
          send({ type: "canceled" });
        } else {
          send({ type: "error", error: s });
        }
      } finally {
        clearInterval(heartbeat);
        endRun(id);
        controller.close(); // <— CLOSE so the browser can immediately reconnect
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "Connection": "keep-alive",
    },
  });
}

async function handleCancelRun(req, env) {
  if (!(await isAuthed(req, env))) return new Response("Unauthorized", { status: 401 });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const { runId } = await req.json().catch(() => ({}));
  if (!runId) return new Response("Bad Request", { status: 400 });

  const exists = !!getRun(runId);
  const ok = cancelRun(runId);
  return new Response(JSON.stringify({ ok, existed: exists }), { headers: { "Content-Type": "application/json" } });
}

async function handleSchedule(req, env) {
  if (req.method === "GET") {
    const raw = await env.CONFIG_KV.get("schedule");
    const fallback = { hourUTC: 7, minuteUTC: 0, enabled: true };
    return new Response(raw ?? JSON.stringify(fallback), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (!(await isAuthed(req, env))) return new Response("Unauthorized", { status: 401 });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const body = await req.json().catch(() => null);
  if (!body) return new Response("Bad Request", { status: 400 });

  const hour = Math.max(0, Math.min(23, Number(body.hourUTC ?? 7) | 0));
  const minute = Math.max(0, Math.min(59, Number(body.minuteUTC ?? 0) | 0));
  const enabled = !!body.enabled;

  await env.CONFIG_KV.put("schedule", JSON.stringify({ hourUTC: hour, minuteUTC: minute, enabled }));
  return new Response("OK", { status: 200 });
}

async function handleData(req, env) {
  if (!env?.LEADERBOARDS) return new Response("R2 not bound", { status: 500 });
  const url = new URL(req.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/data\/?/, ""));
  if (!key) return new Response("Not found", { status: 404 });

  const obj = await env.LEADERBOARDS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  const isJSON = key.endsWith(".json");
  return new Response(obj.body, {
    headers: {
      "Content-Type": isJSON ? "application/json" : "application/octet-stream",
      "Cache-Control": isJSON ? "public, max-age=3600, stale-while-revalidate=59" : "public, max-age=604800, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;

    // API routes
    if (p === "/api/login")             return handleLogin(req, env);
    if (p === "/api/update")            return handleUpdate(req, env);
    if (p === "/api/update-stream")     return handleUpdateStream(req, env);
    if (p === "/api/cancel-run")        return handleCancelRun(req, env);
    if (p === "/api/schedule")          return handleSchedule(req, env);
    if (p.startsWith("/data/"))         return handleData(req, env);

    // Everything else → static assets (your Next export)
    return env.ASSETS.fetch(req, ctx);
  }
};
