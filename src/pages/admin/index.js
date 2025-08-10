// src/pages/admin/index.js
export const config = { runtime: 'experimental-edge' };

import { useEffect, useRef, useState } from "react";
import { verifySession } from "../../lib/auth";

export default function Admin({ authed }) {
  // --- simple styles to match your current page ---
  const styles = `
    body{font-family:system-ui,sans-serif;margin:2rem;max-width:820px}
    input,button{padding:.5rem .75rem} .row{display:flex;gap:.5rem;align-items:center;margin:.5rem 0}
    .card{border:1px solid #ddd;padding:1rem;border-radius:.75rem;margin-bottom:1rem}
    pre{background:#111;color:#eee;padding:1rem;border-radius:.5rem;max-height:40vh;overflow:auto;white-space:pre-wrap}
    label{width:160px;display:inline-block}
    ul{padding-left:1.2rem}
    .muted{opacity:.7}
    .btns{display:flex;gap:.5rem;flex-wrap:wrap}
    .danger{background:#b30000;color:#fff;border:0}
    button[disabled]{opacity:.6;cursor:not-allowed}
  `;

  if (!authed) {
    return <Login styles={styles} />;
  }
  return <AdminUI styles={styles} />;
}

// --- Login view ---
function Login({ styles }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [busy, setBusy] = useState(false);

  async function login() {
    setBusy(true);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      if (r.ok) {
        location.reload();
      } else {
        alert("Invalid credentials");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <HeadTitle />
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <h1>Leaderboards Admin — Login</h1>
      <div className="card">
        <div className="row">
          <label>Username</label>
          <input value={u} onChange={(e) => setU(e.target.value)} />
        </div>
        <div className="row">
          <label>Password</label>
          <input type="password" value={p} onChange={(e) => setP(e.target.value)} />
        </div>
        <div className="btns">
          <button onClick={login} disabled={busy}>Login</button>
        </div>
      </div>
    </>
  );
}

// --- Admin view ---
function AdminUI({ styles }) {
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState([]);
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const logsRef = useRef(null);
  const esRef = useRef(null);
  const runIdRef = useRef(null);

  function append(msg) {
    const el = logsRef.current;
    if (!el) return;
    el.textContent += msg + "\n";
    el.scrollTop = el.scrollHeight;
  }
  function clearLogs() {
    if (logsRef.current) logsRef.current.textContent = "";
    setManifest([]);
  }
  function setBusyState(b) {
    setBusy(b);
  }

  async function runUpdate() {
    clearLogs(); setBusyState(true);
    append("Running (one-shot)...");
    try {
      const r = await fetch("/api/update", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (d.logs) d.logs.forEach(append); else append(JSON.stringify(d, null, 2));
      if (Array.isArray(d.manifest)) setManifest(d.manifest);
    } finally {
      setBusyState(false);
    }
  }

  function runLive() {
    clearLogs(); setBusyState(true);
    append("Connecting (live)...");
    const es = new EventSource("/api/update-stream");
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "start") {
          runIdRef.current = data.runId;
          append("Started " + new Date(data.at).toLocaleString());
        }
        if (data.type === "log") append(data.msg);
        if (data.type === "manifest") setManifest(data.manifest || []);
        if (data.type === "done") { append("✅ Done"); cleanup(); }
        if (data.type === "canceled") { append("⏸ Canceled"); cleanup(); }
        if (data.type === "error") { append("❌ " + data.error); cleanup(); }
      } catch {
        append(e.data);
      }
    };
    es.onerror = () => { append("❌ stream error"); cleanup(); };
  }

  async function cancelRun() {
    if (!runIdRef.current) return;
    append("Sending cancel...");
    try {
      await fetch("/api/cancel-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: runIdRef.current }),
      });
    } catch {}
  }

  function cleanup() {
    if (esRef.current) { try { esRef.current.close(); } catch {} esRef.current = null; }
    runIdRef.current = null;
    setBusyState(false);
  }

  async function saveSchedule() {
    const body = {
      hourUTC: Number(hour || 7),
      minuteUTC: Number(minute || 0),
      enabled: !!enabled,
    };
    const r = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    alert(r.ok ? "Saved" : "Failed");
  }

  return (
    <>
      <HeadTitle />
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <h1>Leaderboards Admin</h1>

      <div className="card">
        <h3>Manual Update</h3>
        <div className="btns">
          <button id="btnOne" onClick={runUpdate} disabled={busy}>Run Now (one-shot)</button>
          <button id="btnLive" onClick={runLive} disabled={busy}>Run (live)</button>
          <button id="btnCancel" className="danger" onClick={cancelRun} disabled={!busy}>Cancel</button>
          <button className="muted" onClick={clearLogs}>Clear</button>
        </div>
        <div id="result">
          {manifest.length > 0 && (
            <>
              <h4>Files written</h4>
              <ul>
                {manifest.map((x) => {
                  const mb = (x.bytes / 1024 / 1024).toFixed(2);
                  const url = "/data/" + encodeURIComponent(x.key);
                  return (
                    <li key={x.key}>
                      <a href={url} target="_blank" rel="noreferrer">{x.key}</a> — {mb} MiB
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <pre id="logs" ref={logsRef} />
      </div>

      <div className="card">
        <h3>Schedule (UTC)</h3>
        <div className="row">
          <label>Hour (0-23)</label>
          <input type="number" min="0" max="23" value={hour} onChange={(e) => setHour(e.target.value)} />
        </div>
        <div className="row">
          <label>Minute (0-59)</label>
          <input type="number" min="0" max="59" value={minute} onChange={(e) => setMinute(e.target.value)} />
        </div>
        <div className="row">
          <label>Enabled</label>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </div>
        <div className="btns">
          <button onClick={saveSchedule}>Save Schedule</button>
        </div>
        <div className="row"><small>America/Detroit ≈ UTC‑4 (summer) / UTC‑5 (winter).</small></div>
      </div>
    </>
  );
}

function HeadTitle() {
  return (
    <>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Leaderboards Admin</title>
    </>
  );
}

// Server-side: check cookie -> authed?
export async function getServerSideProps({ req, res }) {
  // no-store to avoid caching this page
  try { res.setHeader("Cache-Control", "no-store"); } catch {}
  const cookie = req.headers.cookie || "";
  const authed = !!(await verifySession({ ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET }, cookie));
  return { props: { authed } };
}
