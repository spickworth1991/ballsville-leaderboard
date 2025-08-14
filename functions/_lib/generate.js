// functions/_lib/generate.js
import { LEAGUE_MAP } from "./league_map.js";

// ---------- Tunables ----------
const MAX_WEEKS = 18;
const RETRIES = 3;

// External subrequests (Sleeper API) per invocation.
// We stop around here so the request ends *before* hitting limits.
const EXT_SUBREQ_BUDGET = 48;

// Cursor & flags
const CURSOR_KEY = "run_cursor_v3";
const DONE_PREFIX = "done"; // KV key: done:{year}:{category}:{leagueId}

// R2 shard locations
const FULL_SHARD_PREFIX   = "leaderboards_shards"; // /{year}/{category}/{leagueId}.json
const WEEKLY_SHARD_PREFIX = "weekly_shards";       // /{year}/{category}/{leagueId}.json

// ---------- Helpers ----------
let extSubreqCount = 0;
function tickExternal() {
  extSubreqCount++;
  if (extSubreqCount >= EXT_SUBREQ_BUDGET) {
    const e = new Error("PAUSE"); e.name = "PAUSE"; throw e;
  }
}

async function fetchWithRetry(url, { signal } = {}, retries = RETRIES) {
  for (let i = 0; i < retries; i++) {
    tickExternal();
    const res = await fetch(url, signal ? { signal } : undefined);
    if (res.ok) return res.json();
    if (i === retries - 1) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await new Promise(r => setTimeout(r, 400 * (i + 1)));
  }
}

const latestWeekOf = (byWeek) => {
  const ns = Object.keys(byWeek).map(Number);
  return ns.length ? Math.max(...ns) : null;
};

function buildWorkList() {
  const items = [];
  for (const [year, cats] of Object.entries(LEAGUE_MAP)) {
    for (const [category, details] of Object.entries(cats)) {
      for (const [division, leagues] of Object.entries(details.divisions)) {
        for (const leagueId of leagues) {
          items.push({ year, category, division, leagueId, displayName: details.name });
        }
      }
    }
  }
  return items;
}

async function kvGetNumber(kv, key, fallback = 0) {
  const raw = await kv.get(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
const sizeOf = (obj) => new TextEncoder().encode(typeof obj === "string" ? obj : JSON.stringify(obj)).length;

// ---------- Main ----------
export async function generateAll(env, log = () => {}, isCanceled = () => false, startCursor = null) {
  if (!env?.LEADERBOARDS) throw new Error("LEADERBOARDS binding missing");
  if (!env?.CONFIG_KV)     throw new Error("CONFIG_KV binding missing");

  extSubreqCount = 0;
  const ac = new AbortController();
  const signal = ac.signal;
  const work = buildWorkList();

  // cursor
  let i = await kvGetNumber(env.CONFIG_KV, CURSOR_KEY, 0);
  if (startCursor && typeof startCursor.i === "number") i = startCursor.i;
  if (i < 0) i = 0;
  if (i >= work.length) return { manifest: [], cursor: null, done: true };

  const manifest = [];
  const put = async (key, value) => {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
    const body = typeof value === "string" ? value : JSON.stringify(value);
    await env.LEADERBOARDS.put(key, body);
    const bytes = sizeOf(body);
    log(`💾 wrote ${key} (${(bytes/1024/1024).toFixed(2)} MiB)`);
    manifest.push({ key, bytes });
  };

  // Ensure players_min.json (one-time) — we do this once at i===0
  if (i === 0) {
    tickExternal();
    const full = await fetch("https://api.sleeper.app/v1/players/nfl");
    if (!full.ok) throw new Error(`Failed players DB: ${full.status} ${full.statusText}`);
    // stream-minimize: only keep fields we actually read (full_name)
    const db = await full.json();
    const min = {};
    for (const [pid, p] of Object.entries(db)) {
      min[pid] = { full_name: p.full_name || "" };
    }
    await put("players_min.json", min);
  }
  const playersObj = await env.LEADERBOARDS.get("players_min.json");
  if (!playersObj) throw new Error("players_min.json missing in R2");
  const playersDB = JSON.parse(await playersObj.text());

  // Process as many leagues as we can under the *external* subrequest budget.
  let processed = 0;
  while (i < work.length) {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
    const w = work[i];

    // Skip if already done (idempotent)
    const doneKey = `${DONE_PREFIX}:${w.year}:${w.category}:${w.leagueId}`;
    if (await env.CONFIG_KV.get(doneKey)) {
      log(`✔ already done ${w.leagueId} (${w.year}/${w.category}) — skipping`);
      i += 1;
      continue;
    }

    const base = `https://api.sleeper.app/v1/league/${w.leagueId}`;
    const info = await fetchWithRetry(base, { signal });
    const leagueName = info.name;
    log(`Processing ${leagueName} — ${w.displayName} — ${w.year}/${w.category} — ${i+1}/${work.length}`);

    const users   = await fetchWithRetry(`${base}/users`,   { signal });
    const rosters = await fetchWithRetry(`${base}/rosters`, { signal });

    const userMap = {}; users.forEach(u => userMap[u.user_id] = u.display_name);
    const rosterMap = {}; rosters.forEach(r => rosterMap[r.roster_id] = r.owner_id);

    // Draft (optional)
    const draftSlotMap = {};
    try {
      const drafts = await fetchWithRetry(`${base}/drafts`, { signal });
      const draftId = drafts?.[0]?.draft_id;
      if (draftId) {
        const dd = await fetchWithRetry(`https://api.sleeper.app/v1/draft/${draftId}`, { signal });
        if (dd?.draft_order) {
          for (const [uid, slot] of Object.entries(dd.draft_order)) draftSlotMap[uid] = slot;
        }
      }
    } catch { /* ignore */ }

    // Weeks
    const matchupsByWeek = {};
    for (let week = 1; week <= MAX_WEEKS; week++) {
      const ms = await fetchWithRetry(`${base}/matchups/${week}`, { signal });
      if (!ms?.length) break;
      matchupsByWeek[week] = ms;
      // Early clutch exit if budget is getting too tight
      if (extSubreqCount >= EXT_SUBREQ_BUDGET - 3) break;
    }

    const latestWeek = latestWeekOf(matchupsByWeek);
    const latestMatchups = latestWeek ? matchupsByWeek[latestWeek] : [];

    // Build per‑league owners & weekly
    const ownersByName = new Map();
    const ensureOwner = (name) => {
      if (!ownersByName.has(name)) ownersByName.set(name, {
        ownerName: name, leagueName, division: w.division, draftSlot: null, weekly: {}, total: 0
      });
      return ownersByName.get(name);
    };

    const weeklyRosters = {};
    for (const [week, ms] of Object.entries(matchupsByWeek)) {
      weeklyRosters[week] = [];
      ms.forEach(m => {
        const ownerId = rosterMap[m.roster_id]; if (!ownerId) return;
        const name = userMap[ownerId];
        const starters = (m.starters || []).map((id,i)=>({
          id, name: playersDB[id]?.full_name || id, points: m.starters_points?.[i] || 0
        }));
        const bench = Object.keys(m.players_points || {})
          .filter(id => !m.starters?.includes(id))
          .map(id => ({ id, name: playersDB[id]?.full_name || id, points: m.players_points[id] }));
        weeklyRosters[week].push({ ownerName: name, starters, bench });
        const pts = (m.starters_points || []).reduce((a,b)=>a+b,0);
        const o = ensureOwner(name); o.weekly[week] = Number(pts.toFixed(2));
        o.draftSlot = o.draftSlot ?? (draftSlotMap[ownerId] || null);
      });
    }
    // season totals
    rosters.forEach(r => {
      const ownerId = r.owner_id; if (!ownerId) return;
      const name = userMap[ownerId];
      const total = parseFloat(`${r.settings.fpts}.${String(r.settings.fpts_decimal).padStart(2,"0")}`);
      const o = ensureOwner(name); o.total = total; o.draftSlot = o.draftSlot ?? (draftSlotMap[ownerId] || null);
    });
    // latest roster snapshot
    if (latestMatchups.length) {
      for (const o of ownersByName.values()) {
        const m = latestMatchups.find(mx => userMap[rosterMap[mx.roster_id]] === o.ownerName);
        if (!m) continue;
        const starters = (m.starters || []).map((id,i)=>({
          id, name: playersDB[id]?.full_name || id, points: m.starters_points?.[i] || 0
        }));
        const bench = Object.keys(m.players_points || {})
          .filter(id => !m.starters?.includes(id))
          .map(id => ({ id, name: playersDB[id]?.full_name || id, points: m.players_points[id] }));
        o.latestRoster = { week: latestWeek, starters, bench };
      }
    }

    const owners = [...ownersByName.values()];
    const weeks = [...new Set(owners.flatMap(o => Object.keys(o.weekly)))].map(Number).sort((a,b)=>a-b);

    // ----- Write per‑league shards (R2) -----
    const fullKey   = `${FULL_SHARD_PREFIX}/${w.year}/${w.category}/${w.leagueId}.json`;
    const weeklyKey = `${WEEKLY_SHARD_PREFIX}/${w.year}/${w.category}/${w.leagueId}.json`;

    await put(fullKey, {
      year: w.year,
      category: w.category,
      division: w.division,
      leagueId: w.leagueId,
      leagueName,
      displayName: w.displayName,
      weeks,
      owners
    });

    await put(weeklyKey, {
      year: w.year,
      category: w.category,
      leagueId: w.leagueId,
      leagueName,
      weekly: weeklyRosters
    });

    // Mark idempotent completion and bump cursor
    await env.CONFIG_KV.put(doneKey, "1");
    i += 1;
    await env.CONFIG_KV.put(CURSOR_KEY, String(i));
    processed += 1;

    // If we’re getting close to budget, politely pause.
    if (extSubreqCount >= EXT_SUBREQ_BUDGET - 2) break;
  }

  const finished = i >= work.length;
  return { manifest, cursor: finished ? null : { i }, done: finished };
}
