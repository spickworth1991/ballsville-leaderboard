// src/pages/admin/index.js
export const config = { runtime: 'edge' };

import { getRequestContext } from '@cloudflare/next-on-pages';
import { verifySession } from '../../lib/auth';

const page = (body) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Leaderboards Admin</title>
  <style>
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
  </style>${body}`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  }
);

export default async function handler(req) {
  const { env } = getRequestContext();            // <-- THIS is how to get bindings on Edge
  const user = await verifySession(env, req.headers.get("cookie") || "");

  if (!user) {
    return page(`
      <h1>Leaderboards Admin — Login</h1>
      <div class="card">
        <div class="row"><label>Username</label><input id="u" /></div>
        <div class="row"><label>Password</label><input id="p" type="password" /></div>
        <div class="btns"><button onclick="login()">Login</button></div>
      </div>
      <script>
      async function login(){
        const r = await fetch('/api/login', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            username: document.getElementById('u').value,
            password: document.getElementById('p').value
          })
        });
        if(r.ok){ location.reload(); } else { alert('Invalid credentials'); }
      }
      </script>
    `);
  }

  return page(`
    <h1>Leaderboards Admin</h1>
    <div class="card">
      <h3>Manual Update</h3>
      <div class="btns">
        <button id="btnOne" onclick="runUpdate()">Run Now (one-shot)</button>
        <button id="btnLive" onclick="runLive()">Run (live)</button>
        <button id="btnCancel" class="danger" onclick="cancelRun()" disabled>Cancel</button>
        <button class="muted" onclick="clearLogs()">Clear</button>
      </div>
      <div id="result"></div>
      <pre id="logs"></pre>
    </div>

    <div class="card">
      <h3>Schedule (UTC)</h3>
      <div class="row"><label>Hour (0-23)</label><input id="hour" type="number" min="0" max="23" value="7"/></div>
      <div class="row"><label>Minute (0-59)</label><input id="minute" type="number" min="0" max="59" value="0"/></div>
      <div class="row"><label>Enabled</label><input id="enabled" type="checkbox" checked/></div>
      <div class="btns"><button onclick="saveSchedule()">Save Schedule</button></div>
      <div class="row"><small>America/Detroit ≈ UTC‑4 (summer) / UTC‑5 (winter).</small></div>
    </div>

    <script>
    const $ = (id)=>document.getElementById(id);
    let es = null, currentRunId = null;

    function append(msg){ const el=$('logs'); el.textContent += (msg + '\\n'); el.scrollTop = el.scrollHeight; }
    function clearLogs(){ $('logs').textContent=''; $('result').innerHTML=''; }
    function setBusy(b){ $('btnOne').disabled=b; $('btnLive').disabled=b; $('btnCancel').disabled=!b; }

    async function runUpdate(){
      clearLogs(); setBusy(true); append('Running (one-shot)...');
      try {
        const r = await fetch('/api/update', { method:'POST' });
        const d = await r.json().catch(()=>({}));
        if (d.logs) d.logs.forEach(append); else append(JSON.stringify(d,null,2));
        if (Array.isArray(d.manifest)) renderManifest(d.manifest);
      } finally { setBusy(false); }
    }

    function runLive(){
      clearLogs(); setBusy(true); append('Connecting (live)...');
      es = new EventSource('/api/update-stream');
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'start') { currentRunId = data.runId; append('Started ' + new Date(data.at).toLocaleString()); }
          if (data.type === 'log') append(data.msg);
          if (data.type === 'manifest') renderManifest(data.manifest || []);
          if (data.type === 'done')  { append('✅ Done'); cleanup(); }
          if (data.type === 'canceled') { append('⏸ Canceled'); cleanup(); }
          if (data.type === 'error') { append('❌ ' + data.error); cleanup(); }
        } catch { append(e.data); }
      };
      es.onerror = () => { append('❌ stream error'); cleanup(); };
    }

    async function cancelRun(){
      if (!currentRunId) return;
      append('Sending cancel...');
      try {
        await fetch('/api/cancel-run', {
          method:'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: currentRunId })
        });
      } catch {}
    }

    function cleanup(){ if (es) { try { es.close(); } catch {} es = null; } currentRunId=null; setBusy(false); }

    function renderManifest(m){
      const items = m.map(x=>{
        const url = '/data/' + encodeURIComponent(x.key);
        const mb = (x.bytes/1024/1024).toFixed(2);
        return '<li><a href="'+url+'" target="_blank">'+x.key+'</a> — '+mb+' MiB</li>';
      }).join('');
      $('result').innerHTML = '<h4>Files written</h4><ul>' + items + '</ul>';
    }

    async function saveSchedule(){
      const body = {
        hourUTC: Number($('hour').value||7),
        minuteUTC: Number($('minute').value||0),
        enabled: $('enabled').checked
      };
      const r = await fetch('/api/schedule', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body)
      });
      alert(r.ok ? 'Saved' : 'Failed');
    }
    </script>
  `);
}
