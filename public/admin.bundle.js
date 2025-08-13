// public/admin.bundle.js
const $ = (id) => document.getElementById(id);

let es = null;
let currentRunId = null;
let cursor = null; // resume token sent by the server between batches

function showAdminUI() {
  $('loginCard').style.display = 'none';
  $('adminCard').style.display = '';
  $('schedCard').style.display = '';
}

async function checkSession() {
  try {
    const r = await fetch('/api/login', { method: 'HEAD' });
    if (r.ok) showAdminUI();
  } catch {}
}

function append(msg) {
  const el = $('logs');
  el.textContent += (msg + '\n');
  el.scrollTop = el.scrollHeight;
}

function clearLogs() {
  $('logs').textContent = '';
  $('result').innerHTML = '';
}

function setBusy(b) {
  $('btnOne').disabled = b;
  $('btnLive').disabled = b;
  $('btnCancel').disabled = !b;
}

window.addEventListener('DOMContentLoaded', () => {
  $('loginBtn').onclick = async () => {
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('u').value, password: $('p').value })
      });
      if (r.ok) {
        showAdminUI();
      } else {
        alert('Invalid credentials');
      }
    } catch {
      alert('Network error');
    }
  };

  $('btnClear').onclick = clearLogs;

  $('btnOne').onclick = async () => {
    clearLogs();
    setBusy(true);
    cursor = null;
    append('Running (one-shot)...');
    try {
      const r = await fetch('/api/update', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (d.logs) d.logs.forEach(append);
      else append(JSON.stringify(d, null, 2));
      if (d.manifest && Array.isArray(d.manifest)) renderManifest(d.manifest);
    } finally {
      setBusy(false);
    }
  };

  $('btnLive').onclick = () => {
    clearLogs();
    setBusy(true);
    cursor = null;
    append('Connecting (live)...');
    connectSSE();
  };

  $('btnCancel').onclick = async () => {
    if (!currentRunId) return;
    append('Sending cancel...');
    try {
      await fetch('/api/cancel-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: currentRunId })
      });
    } catch {}
  };

  $('saveSchedule').onclick = async () => {
    const body = {
      hourUTC: Number($('hour').value || 7),
      minuteUTC: Number($('minute').value || 0),
      enabled: $('enabled').checked
    };
    const r = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    alert(r.ok ? 'Saved' : 'Failed');
  };

  checkSession();
});

function connectSSE() {
  // Build the URL and include cursor if we have one (for auto-resume)
  const url = new URL('/api/update-stream', location.origin);
  if (cursor) url.searchParams.set('cursor', JSON.stringify(cursor));

  es = new EventSource(url.toString());

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);

      if (data.type === 'start') {
        currentRunId = data.runId || null;
        append('Started ' + new Date(data.at).toLocaleString());
      }

      if (data.type === 'log') {
        append(data.msg);
      }

      if (data.type === 'manifest') {
        renderManifest(data.manifest || []);
      }

      // NEW: server can ask us to continue with a cursor (after batch completes)
      if (data.type === 'continue') {
        cursor = data.cursor || null;
        append('⏭️ Continuing...');
        try { es.close(); } catch {}
        // Immediately reconnect with the provided cursor
        connectSSE();
        return;
      }

      if (data.type === 'done') {
        append('✅ Done');
        cursor = null;
        cleanup();
      }

      if (data.type === 'canceled') {
        append('⏸ Canceled');
        cursor = null;
        cleanup();
      }

      if (data.type === 'error') {
        append('❌ ' + data.error);
        cursor = null;
        cleanup();
      }
    } catch {
      // Fallback when a non-JSON line sneaks through (e.g., keepalive)
      append(e.data);
    }
  };

  es.onerror = () => {
    append('❌ stream error');
    cleanup();
  };
}

function cleanup() {
  if (es) {
    try { es.close(); } catch {}
    es = null;
  }
  currentRunId = null;
  setBusy(false);
}

function renderManifest(m) {
  const items = m.map(x => {
    const url = '/data/' + encodeURIComponent(x.key);
    const mb = (x.bytes / 1024 / 1024).toFixed(2);
    return '<li><a href="' + url + '" target="_blank">' + x.key + '</a> — ' + mb + ' MiB</li>';
  }).join('');
  $('result').innerHTML = '<h4>Files written</h4><ul>' + items + '</ul>';
}
