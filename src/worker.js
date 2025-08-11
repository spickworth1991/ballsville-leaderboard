// Main Cloudflare Worker entry point - improved for your setup
export default {
  // Handle HTTP requests
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    try {
      // API routes - import your existing handlers
      if (pathname === '/api/login') {
        const { default: handler } = await import('./pages/api/login.js');
        return handler(request, { env, ctx });
      }
      
      if (pathname === '/api/schedule') {
        const { default: handler } = await import('./pages/api/schedule.js');
        return handler(request, { env, ctx });
      }
      
      if (pathname === '/api/update') {
        const { default: handler } = await import('./pages/api/update.js');
        return handler(request, { env, ctx });
      }
      
      if (pathname === '/api/update-stream') {
        const { default: handler } = await import('./pages/api/update-stream.js');
        return handler(request, { env, ctx });
      }
      
      if (pathname === '/api/cancel-run') {
        const { default: handler } = await import('./pages/api/cancel-run.js');
        return handler(request, { env, ctx });
      }
      
      if (pathname === '/api/r2-diagnostics') {
        const { default: handler } = await import('./pages/api/r2-diagnostics.js');
        return handler(request, { env, ctx });
      }
      
      // Data routes - serve from R2
      if (pathname.startsWith('/data/')) {
        const { default: handler } = await import('./pages/api/data/[key].js');
        return handler(request, { env, ctx });
      }
      
      // Admin page - serve your existing static admin
      if (pathname === '/admin' || pathname === '/admin.html') {
        const { default: handler } = await import('./pages/admin.js');
        return handler(request, { env, ctx });
      }
      
      // Admin bundle - serve the JavaScript
      if (pathname === '/admin.bundle.js') {
        // Read from your existing file or inline it
        const bundleContent = `
// Your existing admin.bundle.js content
const $ = (id) => document.getElementById(id);
let es = null, currentRunId = null;

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
  el.textContent += (msg + '\\n');
  el.scrollTop = el.scrollHeight;
}
function clearLogs() { $('logs').textContent = ''; $('result').innerHTML = ''; }
function setBusy(b) { $('btnOne').disabled = b; $('btnLive').disabled = b; $('btnCancel').disabled = !b; }

window.addEventListener('DOMContentLoaded', () => {
  $('loginBtn').onclick = async () => {
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('u').value, password: $('p').value })
      });
      if (r.ok) { showAdminUI(); } else { alert('Invalid credentials'); }
    } catch { alert('Network error'); }
  };

  $('btnClear').onclick = clearLogs;

  $('btnOne').onclick = async () => {
    clearLogs(); setBusy(true);
    append('Running (one-shot)...');
    try {
      const r = await fetch('/api/update', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (d.logs) d.logs.forEach(append); else append(JSON.stringify(d, null, 2));
      if (d.manifest && Array.isArray(d.manifest)) renderManifest(d.manifest);
    } finally { setBusy(false); }
  };

  $('btnLive').onclick = () => {
    clearLogs(); setBusy(true);
    append('Connecting (live)...');
    es = new EventSource('/api/update-stream');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'start') { currentRunId = data.runId; append('Started ' + new Date(data.at).toLocaleString()); }
        if (data.type === 'log') append(data.msg);
        if (data.type === 'manifest') renderManifest(data.manifest || []);
        if (data.type === 'done') { append('✅ Done'); cleanup(); }
        if (data.type === 'canceled') { append('⏸ Canceled'); cleanup(); }
        if (data.type === 'error') { append('❌ ' + data.error); cleanup(); }
      } catch { append(e.data); }
    };
    es.onerror = () => { append('❌ stream error'); cleanup(); };
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

function cleanup() { if (es) { try { es.close(); } catch {} es = null; } currentRunId = null; setBusy(false); }

function renderManifest(m) {
  const items = m.map(x => {
    const url = '/data/' + encodeURIComponent(x.key);
    const mb = (x.bytes / 1024 / 1024).toFixed(2);
    return '<li><a href="' + url + '" target="_blank">' + x.key + '</a> — ' + mb + ' MiB</li>';
  }).join('');
  $('result').innerHTML = '<h4>Files written</h4><ul>' + items + '</ul>';
}
        `;
        
        return new Response(bundleContent, {
          headers: {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }
      
      // Redirect root to main leaderboard (not admin)
      if (pathname === '/') {
        return new Response('', {
          status: 302,
          headers: { 'Location': '/index.html' }
        });
      }
      
      return new Response('Not Found', { status: 404 });
      
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(`Internal Server Error: \${error.message}\`, { status: 500 });
    }
  },

  // Handle scheduled events (cron triggers)
  async scheduled(event, env, ctx) {
    console.log('🕐 Scheduled event triggered at:', new Date().toISOString());
    console.log('Cron pattern:', event.cron);
    
    try {
      // Check if scheduling is enabled
      const scheduleRaw = await env.CONFIG_KV.get("schedule");
      const schedule = scheduleRaw ? JSON.parse(scheduleRaw) : { 
        hourUTC: 7, 
        minuteUTC: 0, 
        enabled: true 
      };
      
      console.log('Current schedule config:', schedule);
      
      if (!schedule.enabled) {
        console.log('⏸️ Scheduled updates are disabled, skipping...');
        return;
      }
      
      // Optional: Additional time validation (if you want more control than just cron)
      const now = new Date();
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();
      
      console.log(\`Current time: \${currentHour}:\${String(currentMinute).padStart(2, '0')} UTC\`);
      console.log(\`Target time: \${schedule.hourUTC}:\${String(schedule.minuteUTC).padStart(2, '0')} UTC\`);
      
      // Run the update
      console.log('🚀 Starting scheduled leaderboard update...');
      
      const { generateAll } = await import('./lib/generate.js');
      
      const logs = [];
      const logFn = (message) => {
        console.log(message);
        logs.push(message);
      };
      
      const startTime = Date.now();
      const { manifest } = await generateAll(env, logFn);
      const duration = Date.now() - startTime;
      
      // Store run metadata
      const runInfo = {
        timestamp: Date.now(),
        duration,
        filesGenerated: manifest.length,
        totalBytes: manifest.reduce((sum, item) => sum + item.bytes, 0),
        cron: event.cron,
        triggered: 'scheduled'
      };
      
      await env.CONFIG_KV.put('last_run_ts', Date.now().toString());
      await env.CONFIG_KV.put('last_run_info', JSON.stringify(runInfo));
      await env.CONFIG_KV.put('last_run_logs', JSON.stringify(logs.slice(-50))); // Keep last 50 logs
      
      const sizeMB = (runInfo.totalBytes / 1024 / 1024).toFixed(2);
      console.log(\`✅ Scheduled update completed successfully!\`);
      console.log(\`   Files generated: \${manifest.length}\`);
      console.log(\`   Total size: \${sizeMB} MB\`);
      console.log(\`   Duration: \${(duration / 1000).toFixed(1)}s\`);
      
      // Optional: Send webhook notification (uncomment and configure)
      /*
      if (env.DISCORD_WEBHOOK_URL || env.SLACK_WEBHOOK_URL) {
        const webhookUrl = env.DISCORD_WEBHOOK_URL || env.SLACK_WEBHOOK_URL;
        const message = {
          content: \`🏈 Leaderboard update completed!\\n📊 Generated \${manifest.length} files (\${sizeMB} MB)\\n⏱️ Duration: \${(duration / 1000).toFixed(1)}s\`,
        };
        
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
          });
          console.log('📤 Webhook notification sent');
        } catch (webhookError) {
          console.error('⚠️ Webhook notification failed:', webhookError);
        }
      }
      */
      
    } catch (error) {
      console.error('❌ Scheduled update failed:', error);
      
      // Store detailed error info
      const errorInfo = {
        timestamp: Date.now(),
        error: String(error),
        stack: error.stack,
        cron: event.cron,
        triggered: 'scheduled'
      };
      
      try {
        await env.CONFIG_KV.put('last_error', JSON.stringify(errorInfo));
        await env.CONFIG_KV.put('last_error_ts', Date.now().toString());
      } catch (kvError) {
        console.error('Failed to store error info:', kvError);
      }
      
      // Re-throw so Cloudflare marks the cron as failed
      throw error;
    }
  }
};