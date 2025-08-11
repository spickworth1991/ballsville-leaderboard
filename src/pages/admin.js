// src/pages/admin.js  (no runtime export; static page)
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
        input{padding:.5rem .75rem;background:#fff;color:#000;border:1px solid #ccc;border-radius:.25rem;outline:none}
        @media (prefers-color-scheme: dark){
          input{background:#1f1f1f;color:#fff;border-color:#444}
        }
        button{padding:.5rem .75rem;background:#f2f2f2;color:#000;border:1px solid #ccc;border-radius:.25rem;cursor:pointer}
        @media (prefers-color-scheme: dark){
          button{background:#2a2a2a;color:#fff;border-color:#444}
        }
      `}</style>

      <h1>Leaderboards Admin — Login</h1>

      <div className="card" id="loginCard">
        <div className="row"><label>Username</label><input id="u" autoComplete="username" /></div>
        <div className="row"><label>Password</label><input id="p" type="password" autoComplete="current-password" /></div>
        <div className="btns"><button id="loginBtn" type="button">Login</button></div>
      </div>

      <div className="card" id="adminCard" style={{ display: 'none' }}>
        <h3>Manual Update</h3>
        <div className="btns">
          <button id="btnOne" type="button">Run Now (one-shot)</button>
          <button id="btnLive" type="button">Run (live)</button>
          <button id="btnCancel" className="danger" disabled type="button">Cancel</button>
          <button className="muted" id="btnClear" type="button">Clear</button>
        </div>
        <div id="result"></div>
        <pre id="logs"></pre>
      </div>

      <div className="card" id="schedCard" style={{ display: 'none' }}>
        <h3>Schedule (UTC)</h3>
        <div className="row"><label>Hour (0-23)</label><input id="hour" type="number" min="0" max="23" defaultValue="7" /></div>
        <div className="row"><label>Minute (0-59)</label><input id="minute" type="number" min="0" max="59" defaultValue="0" /></div>
        <div className="row"><label>Enabled</label><input id="enabled" type="checkbox" defaultChecked /></div>
        <div className="btns"><button id="saveSchedule" type="button">Save Schedule</button></div>
        <div className="row"><small>America/Detroit ≈ UTC‑4 (summer) / UTC‑5 (winter).</small></div>
      </div>

      {/* Load external script so CSP allows it */}
      <script src="/admin.bundle.js" defer />
    </>
  );
}
