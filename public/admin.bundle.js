// public/admin.bundle.js
const $ = (id) => document.getElementById(id);
let es = null, currentRunId = null;
let cursor = null; // <— add

// ...existing code...

$('btnLive').onclick = () => {
  clearLogs(); setBusy(true);
  append('Connecting (live)...');
  connectSSE(); // <— use a function so we can reconnect
};

function connectSSE() {
  // build URL with cursor if present
  const u = new URL('/api/update-stream', location.origin);
  if (cursor) u.searchParams.set('cursor', JSON.stringify(cursor));
  es = new EventSource(u.toString());

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'start') { currentRunId = data.runId; append('Started ' + new Date(data.at).toLocaleString()); }
      if (data.type === 'log') append(data.msg);
      if (data.type === 'manifest') renderManifest(data.manifest || []);
      if (data.type === 'continue') {
        cursor = data.cursor || null;
        append('⏭️ Continuing…');
        es.close();
        connectSSE(); // immediate resume
      }
      if (data.type === 'done') { append('✅ Done'); cleanup(); cursor = null; }
      if (data.type === 'canceled') { append('⏸ Canceled'); cleanup(); cursor = null; }
      if (data.type === 'error') { append('❌ ' + data.error); cleanup(); cursor = null; }
    } catch { append(e.data); }
  };
  es.onerror = () => { append('❌ stream error'); cleanup(); /* keep cursor for manual retry */ };
}

function cleanup() { if (es) { try { es.close(); } catch {} es = null; } currentRunId = null; setBusy(false); }
