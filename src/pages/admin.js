// NO runtime export here — we want a static page, not an Edge Function.

export default function AdminPage() {
  return (
    <>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Leaderboards Admin</title>

      <style>{`
        :root { color-scheme: light dark; }
        body{font-family:system-ui,sans-serif;margin:2rem;max-width:820px}
        .row{display:flex;gap:.5rem;align-items:center;margin:.5rem 0}
        .card{border:1px solid #ddd;padding:1rem;border-radius:.75rem;margin-bottom:1rem}
        pre{background:#111;color:#eee;padding:1rem;border-radius:.5rem;max-height:40vh;overflow:auto;white-space:pre-wrap}
        label{width:160px;display:inline-block}
        ul{padding-left:1.2rem}
        .muted{opacity:.7}
        .btns{display:flex;gap:.5rem;flex-wrap:wrap}
        .danger{background:#b30000;color:#fff;border:0}
        button[disabled]{opacity:.6;cursor:not-allowed}

        input{
          padding:.5rem .75rem;background:#fff;color:#000;border:1px solid #ccc;border-radius:.25rem;outline:none;
        }
        @media (prefers-color-scheme: dark){
          input{background:#1f1f1f;color:#fff;border-color:#444;}
        }
        button{
          padding:.5rem .75rem;background:#f2f2f2;color:#000;border:1px solid #ccc;border-radius:.25rem;cursor:pointer;
        }
        @media (prefers-color-scheme: dark){
          button{background:#2a2a2a;color:#fff;border-color:#444;}
        }
      `}</style>

      <h1>Leaderboards Admin — Login</h1>

      <div className="card" id="loginCard">
        <div className="row"><label>Username</label><input id="u" autoComplete="username" /></div>
        <div className="row"><label>Password</label><input id="p" type="password" autoComplete="current-password" /></div>
        <div className="btns">
          <button id="loginBtn">Login</button>
        </div>
      </div>

      <div className="card" id="adminCard" style={{ display: 'none' }}>
        <h3>Manual Update</h3>
        <div className="btns">
          <button id="btnOne">Run Now (one-shot)</button>
          <button id="btnLive">Run (live)</button>
          <button id="btnCancel" className="danger" disabled>Cancel</button>
          <button className="muted" id="btnClear">Clear</button>
        </div>
        <div id="result"></div>
        <pre id="logs"></pre>
      </div>

      <div className="card" id="schedCard" style={{ display: 'none' }}>
        <h3>Schedule (UTC)</h3>
        <div className="row"><label>Hour (0-23)</label><input id="hour" type="number" min="0" max="23" defaultValue="7" /></div>
        <div className="row"><label>Minute (0-59)</label><input id="minute" type="number" min="0" max="59" defaultValue="0" /></div>
        <div className="row"><label>Enabled</label><input id="enabled" type="checkbox" defaultChecked /></div>
        <div className="btns"><button id="saveSchedule">Save Schedule</button></div>
        <div className="row"><small>America/Detroit ≈ UTC‑4 (summer) / UTC‑5 (winter).</small></div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            const $=(id)=>document.getElementById(id);
            let es=null, currentRunId=null;

            function showAdminUI(){
              $('loginCard').style.display='none';
              $('adminCard').style.display='';
              $('schedCard').style.display='';
            }

            async function checkSession(){
              try{
                const r = await fetch('/api/login', { method:'HEAD' });
                if(r.ok) showAdminUI();
              }catch{}
            }

            function append(msg){ const el=$('logs'); el.textContent+=(msg+'\\n'); el.scrollTop=el.scrollHeight; }
            function clearLogs(){ $('logs').textContent=''; $('result').innerHTML=''; }
            function setBusy(b){ $('btnOne').disabled=b; $('btnLive').disabled=b; $('btnCancel').disabled=!b; }

            $('loginBtn').onclick = async ()=>{
              try{
                const r = await fetch('/api/login', {
                  method:'POST',
                  headers:{'Content-Type':'application/json'},
                  body: JSON.stringify({ username:$('u').value, password:$('p').value })
                });
                if(r.ok){ showAdminUI(); } else { alert('Invalid credentials'); }
              }catch(e){ alert('Network error'); }
            };

            $('btnClear').onclick = clearLogs;

            $('btnOne').onclick = async ()=>{
              clearLogs(); setBusy(true);
              append('Running (one-shot)...');
              try{
                const r = await fetch('/api/update', { method:'POST' });
                const d = await r.json().catch(()=>({}));
                if(d.logs) d.logs.forEach(append); else append(JSON.stringify(d,null,2));
                if(d.manifest && Array.isArray(d.manifest)) renderManifest(d.manifest);
              }finally{ setBusy(false); }
            };

            $('btnLive').onclick = ()=>{
              clearLogs(); setBusy(true);
              append('Connecting (live)...');
              es = new EventSource('/api/update-stream');
              es.onmessage = (e)=>{
                try{
                  const data = JSON.parse(e.data);
                  if(data.type==='start'){ currentRunId=data.runId; append('Started '+new Date(data.at).toLocaleString()); }
                  if(data.type==='log') append(data.msg);
                  if(data.type==='manifest') renderManifest(data.manifest||[]);
                  if(data.type==='done'){ append('✅ Done'); cleanup(); }
                  if(data.type==='canceled'){ append('⏸ Canceled'); cleanup(); }
                  if(data.type==='error'){ append('❌ '+data.error); cleanup(); }
                }catch{ append(e.data); }
              };
              es.onerror = ()=>{ append('❌ stream error'); cleanup(); };
            };

            $('btnCancel').onclick = async ()=>{
              if(!currentRunId) return;
              append('Sending cancel...');
              try{
                await fetch('/api/cancel-run', {
                  method:'POST',
                  headers:{'Content-Type':'application/json'},
                  body: JSON.stringify({ runId: currentRunId })
                });
              }catch{}
            };

            function cleanup(){ if(es){ try{ es.close(); }catch{} es=null; } currentRunId=null; setBusy(false); }

            function renderManifest(m){
              const items=m.map(x=>{
                const url='/data/'+encodeURIComponent(x.key);
                const mb=(x.bytes/1024/1024).toFixed(2);
                return '<li><a href="'+url+'" target="_blank">'+x.key+'</a> — '+mb+' MiB</li>';
              }).join('');
              $('result').innerHTML='<h4>Files written</h4><ul>'+items+'</ul>';
            }

            $('saveSchedule').onclick = async ()=>{
              const body = {
                hourUTC: Number($('hour').value||7),
                minuteUTC: Number($('minute').value||0),
                enabled: $('enabled').checked
              };
              const r = await fetch('/api/schedule', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify(body)
              });
              alert(r.ok ? 'Saved' : 'Failed');
            };

            // try to auto-detect existing session
            checkSession();
          `,
        }}
      />
    </>
  );
}
