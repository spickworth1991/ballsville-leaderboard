// functions/_lib/generate.js
import { LEAGUE_MAP } from "./league_map.js";

/**
 * Batching strategy:
 * - Handle up to MAX_LEAGUES_PER_REQUEST per call.
 * - For each league, fetch multiple weeks per tick (WEEKS_PER_TICK).
 * - Persist partial league state in KV (RUN_STATE_V5) if we need to pause.
 *
 * Tweak these knobs to fit your account’s limits.
 */
const RETRIES = 3;
const MAX_WEEKS = 18;

// How much to attempt per request
const MAX_LEAGUES_PER_REQUEST = 5;   // try small first; you can raise if stable
const WEEKS_PER_TICK = 6;            // weeks to fetch per league tick

// Request safety limits
const SUBREQ_BUDGET = 45;            // stay under CF subrequest cap
const CPU_MS_BUDGET = 120;           // soft CPU wall; pause if we exceed

// Sharding & KV keys
const MAX_CHUNK = 23 * 1024 * 1024;  // weekly part size ~23MiB
const CURSOR_KEY = "run_cursor_v5";   // global league index
const RUN_STATE_KEY = "run_state_v5"; // in-progress league snapshot
const SHARD_LIST_FULL = "shard_list_full_v2"; // [{year,category}...]

// ---------- small helpers ----------
let subreqCount = 0;
function bumpSubreq() {
  if (++subreqCount >= SUBREQ_BUDGET) {
    const e = new Error("PAUSE"); e.name = "PAUSE"; throw e;
  }
}
async function fetchJSON(url, signal) {
  bumpSubreq();
  const r = await fetch(url, signal ? { signal } : undefined);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}
async function fetchWithRetry(url, retries, signal) {
  for (let i = 0; i < retries; i++) {
    try { return await fetchJSON(url, signal); }
    catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}
function elapsed(start) { return Date.now() - start; }
function maybePause(start, extraCondition = false) {
  if (extraCondition || elapsed(start) > CPU_MS_BUDGET) {
    const e = new Error("PAUSE"); e.name = "PAUSE"; throw e;
  }
}
function sizeOfJSON(obj){ return new TextEncoder().encode(JSON.stringify(obj)).length; }
async function r2GetJSON(bucket, key, fallback = {}) {
  const obj = await bucket.get(key);
  if (!obj) return fallback;
  const txt = typeof obj.text === "function" ? await obj.text() : await new Response(obj.body).text();
  try { return JSON.parse(txt); } catch { return fallback; }
}
async function kvGetJSON(kv, key, fallback = {}) {
  const txt = await kv.get(key);
  if (!txt) return fallback;
  try { return JSON.parse(txt); } catch { return fallback; }
}
async function kvPutJSON(kv, key, value){ await kv.put(key, JSON.stringify(value)); }

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
const latestWeek = (m) => {
  const weeks = Object.keys(m).map(Number);
  return weeks.length ? Math.max(...weeks) : null;
};

// merging
function uniqPushOwner(arr, item) {
  if (!arr.__idx) arr.__idx = new Map();
  const key = `${item.leagueName}::${item.ownerName}`;
  if (!arr.__idx.has(key)) { arr.__idx.set(key, arr.length); arr.push(item); }
  else {
    const ex = arr[arr.__idx.get(key)];
    ex.total  = item.total ?? ex.total ?? 0;
    ex.weekly = { ...(ex.weekly||{}), ...(item.weekly||{}) };
    if (item.latestRoster) ex.latestRoster = item.latestRoster;
    ex.draftSlot = ex.draftSlot ?? item.draftSlot ?? null;
  }
}
function mergeShardFull(existing, add, y, c, displayName, divisionsList) {
  const dst = existing[y]?.[c] ?? {
    name: displayName, weeks: [], owners: [], divisions: divisionsList, leaguesByDivision: {}
  };
  const src = add[y][c];

  // weeks
  const wk = new Set([...(dst.weeks||[]), ...(src.weeks||[])]);
  dst.weeks = [...wk].map(Number).sort((a,b)=>a-b);

  // divisions & leagues
  dst.divisions = Array.from(new Set([...(dst.divisions||[]), ...divisionsList]));
  dst.leaguesByDivision ??= {};
  for (const [div, names] of Object.entries(src.leaguesByDivision || {})) {
    dst.leaguesByDivision[div] ??= [];
    const s = new Set(dst.leaguesByDivision[div]);
    (names||[]).forEach(n => s.add(n));
    dst.leaguesByDivision[div] = [...s];
  }

  // owners
  dst.owners ??= [];
  for (const o of (src.owners || [])) uniqPushOwner(dst.owners, o);
  if (dst.owners.__idx) delete dst.owners.__idx;

  return { [y]: { [c]: dst } };
}
function mergeWeeklyShard(existing, add, y, c) {
  const dst = existing[y]?.[c] ?? {};
  const src = add[y][c] || {};
  for (const [leagueName, weekly] of Object.entries(src)) {
    dst[leagueName] = { ...(dst[leagueName] || {}), ...(weekly || {}) };
  }
  return { [y]: { [c]: dst } };
}

// ---------- main ----------
export async function generateAll(env, log = () => {}, isCanceled = () => false) {
  if (!env?.LEADERBOARDS?.put) throw new Error("LEADERBOARDS binding missing");
  if (!env?.CONFIG_KV) throw new Error("CONFIG_KV binding missing");

  subreqCount = 0;
  const startedAt = Date.now();
  const ac = new AbortController();
  const signal = ac.signal;

  const manifest = [];
  const put = async (key, value) => {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
    const bytes = typeof value === "string"
      ? new TextEncoder().encode(value).length
      : value?.byteLength ?? String(value).length;
    await env.LEADERBOARDS.put(key, value);
    log(`💾 wrote ${key} (${(bytes/1024/1024).toFixed(2)} MiB)`);
    manifest.push({ key, bytes });
    return { key, bytes };
  };

  const work = buildWorkList();

  // global cursor
  let i = Number(await env.CONFIG_KV.get(CURSOR_KEY)) || 0;
  if (i >= work.length) return { manifest, cursor: null, done: true };

  // ensure players DB once
  let players = await env.LEADERBOARDS.get("sleeper_players.json");
  if (!players) {
    const fresh = await fetchWithRetry("https://api.sleeper.app/v1/players/nfl", RETRIES, signal);
    await put("sleeper_players.json", JSON.stringify(fresh));
    players = await env.LEADERBOARDS.get("sleeper_players.json");
  }
  const playersDB = JSON.parse(await players.text());

  // per-shard helpers
  const fullKeyFor   = (yy, cc)      => `leaderboards/${yy}/${cc}.json`;
  const weeklyKeyFor = (yy, cc, n)   => `weekly/${yy}/${cc}/part${n}.json`;
  const weeklyPartIdxKey = (yy, cc)  => `WEEKLY_PART_IDX:${yy}:${cc}`;

  // load or seed in-progress state
  let state = await kvGetJSON(env.CONFIG_KV, RUN_STATE_KEY, null);
  if (!state || state.i < i || state.i >= work.length) {
    state = { i, stage: "league", weekPtr: 1, ownersMap: null, weeklyRosters: {}, leagueName: null };
    await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);
  }

  let processedThisCall = 0;

  // process up to MAX_LEAGUES_PER_REQUEST
  while (processedThisCall < MAX_LEAGUES_PER_REQUEST && i < work.length) {
    const w = work[i];

    // If the saved state doesn't match current i, reset per-league state
    if (state.i !== i) {
      state = { i, stage: "league", weekPtr: 1, ownersMap: null, weeklyRosters: {}, leagueName: null };
      await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);
    }

    // Stage: fetch league metadata (info/users/rosters/draft)
    if (state.stage === "league") {
      const base = `https://api.sleeper.app/v1/league/${w.leagueId}`;
      const info    = await fetchWithRetry(base, RETRIES, signal);
      const users   = await fetchWithRetry(`${base}/users`,   RETRIES, signal);
      const rosters = await fetchWithRetry(`${base}/rosters`, RETRIES, signal);
      const userMap = {}; users.forEach(u => userMap[u.user_id] = u.display_name);
      const rosterMap = {}; rosters.forEach(r => rosterMap[r.roster_id] = r.owner_id);

      let draftSlotMap = {};
      try {
        const drafts = await fetchWithRetry(`${base}/drafts`, RETRIES, signal);
        const draftId = drafts?.[0]?.draft_id;
        if (draftId) {
          const dd = await fetchWithRetry(`https://api.sleeper.app/v1/draft/${draftId}`, RETRIES, signal);
          if (dd?.draft_order) Object.entries(dd.draft_order).forEach(([uid, slot]) => { draftSlotMap[uid] = slot; });
        }
      } catch {}

      state.leagueName = info.name;
      state.ownersMap = { userMap, rosterMap, draftSlotMap };
      state.stage = "weeks";
      // minimal log once per league
      log(`Processing ${state.leagueName} - ${w.division} - ${w.displayName} - ${i+1}/${work.length}`);
      await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);
      maybePause(startedAt);
    }

    // Stage: fetch weeks in chunks
    if (state.stage === "weeks") {
      const base = `https://api.sleeper.app/v1/league/${w.leagueId}`;
      const { userMap, rosterMap, draftSlotMap } = state.ownersMap;

      let grabbed = 0;
      while (state.weekPtr <= MAX_WEEKS && grabbed < WEEKS_PER_TICK) {
        // fetch a week
        const ms = await fetchWithRetry(`${base}/matchups/${state.weekPtr}`, RETRIES, signal);
        if (!ms?.length) { state.stage = "totals"; break; }

        const week = state.weekPtr;
        const thisWeekRosters = [];
        for (const m of ms) {
          const ownerId = rosterMap[m.roster_id];
          if (!ownerId) continue;
          const name = userMap[ownerId];
          const starters = (m.starters || []).map((id, idx) => ({
            id, name: playersDB[id]?.full_name || id, points: m.starters_points?.[idx] || 0
          }));
          const bench = Object.keys(m.players_points || {})
            .filter(id => !m.starters?.includes(id))
            .map(id => ({ id, name: playersDB[id]?.full_name || id, points: m.players_points[id] }));
          thisWeekRosters.push({ ownerName: name, starters, bench });
        }

        state.weeklyRosters[week] = thisWeekRosters;
        state.weekPtr += 1;
        grabbed += 1;

        // keep an eye on CPU/subreq
        await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);
        maybePause(startedAt);
      }

      // If we fetched WEEKS_PER_TICK or ran out of weeks, either move to totals or pause
      if (state.stage !== "totals" && (grabbed >= WEEKS_PER_TICK)) {
        // pause to stay within CPU; resume will keep fetching remaining weeks
        const e = new Error("PAUSE"); e.name = "PAUSE"; throw e;
      }
      if (state.stage !== "totals" && state.weekPtr > MAX_WEEKS) {
        state.stage = "totals";
        await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);
        maybePause(startedAt);
      }
    }

    // Stage: totals + latest, then write shards once per league
    if (state.stage === "totals") {
      const { userMap, rosterMap, draftSlotMap } = state.ownersMap;
      const base = `https://api.sleeper.app/v1/league/${w.leagueId}`;

      // season totals
      const rosters = await fetchWithRetry(`${base}/rosters`, RETRIES, signal);
      const ownersTotals = [];
      for (const r of rosters) {
        const ownerId = r.owner_id; if (!ownerId) continue;
        const name = userMap[ownerId];
        const total = parseFloat(`${r.settings.fpts}.${String(r.settings.fpts_decimal).padStart(2,"0")}`);
        ownersTotals.push({
          ownerName: name,
          leagueName: state.leagueName,
          division: w.division,
          draftSlot: draftSlotMap[ownerId] || null,
          weekly: {},
          total
        });
      }

      // latest roster snapshot from last collected week
      const lastW = Object.keys(state.weeklyRosters).map(Number).sort((a,b)=>a-b).pop();
      const ownersWithLatest = [];
      if (lastW != null) {
        const lastWeekEntries = state.weeklyRosters[lastW] || [];
        for (const e of lastWeekEntries) {
          ownersWithLatest.push({
            ownerName: e.ownerName,
            leagueName: state.leagueName,
            division: w.division,
            draftSlot: null,
            weekly: {},
            total: 0,
            latestRoster: { week: lastW, starters: e.starters, bench: e.bench }
          });
        }
      }

      // Build full shard payload
      const divisionsList = Object.keys(LEAGUE_MAP[w.year][w.category].divisions);
      const weeksNumbers = Object.keys(state.weeklyRosters).map(Number).sort((a,b)=>a-b);
      // owners weekly aggregations from weeklyRosters
      const ownersByName = new Map();
      const ensureOwner = (name) => {
        if (!ownersByName.has(name)) ownersByName.set(name, {
          ownerName: name, leagueName: state.leagueName, division: w.division, draftSlot: null, weekly: {}, total: 0
        });
        return ownersByName.get(name);
      };
      for (const [wk, arr] of Object.entries(state.weeklyRosters)) {
        for (const entry of arr) {
          const o = ensureOwner(entry.ownerName);
          const pts = (entry.starters || []).reduce((acc, s) => acc + (s.points || 0), 0);
          o.weekly[wk] = Number(pts.toFixed(2));
        }
      }
      // insert totals and draft slots
      for (const t of ownersTotals) {
        const o = ensureOwner(t.ownerName);
        o.total = t.total;
        o.draftSlot = o.draftSlot ?? t.draftSlot ?? null;
      }

      const ownersArray = [...ownersByName.values()];
      const shardFullAdd = {
        [w.year]: {
          [w.category]: {
            name: w.displayName,
            weeks: weeksNumbers,
            owners: ownersArray.concat(ownersWithLatest), // include latest roster entries
            divisions: divisionsList,
            leaguesByDivision: { [w.division]: [state.leagueName] }
          }
        }
      };

      // merge and write FULL shard
      const fullKey = fullKeyFor(w.year, w.category);
      const existingFull = await r2GetJSON(env.LEADERBOARDS, fullKey, { [w.year]: { [w.category]: undefined } });
      const mergedFull   = mergeShardFull(existingFull, shardFullAdd, w.year, w.category, w.displayName, divisionsList);
      await put(fullKey, JSON.stringify(mergedFull, null, 2));

      // write WEEKLY shard (all collected weeks for this league)
      const weeklyAdd = { [w.year]: { [w.category]: { [state.leagueName]: state.weeklyRosters } } };
      const idxKey = weeklyPartIdxKey(w.year, w.category);
      let partIdx = Number(await env.CONFIG_KV.get(idxKey)) || 1;
      const wkKey = (n) => weeklyKeyFor(w.year, w.category, n);

      const curPart = await r2GetJSON(env.LEADERBOARDS, wkKey(partIdx), { [w.year]: { [w.category]: {} } });
      const attempt = mergeWeeklyShard(curPart, weeklyAdd, w.year, w.category);
      if (sizeOfJSON(attempt) <= MAX_CHUNK) {
        await put(wkKey(partIdx), JSON.stringify(attempt));
      } else {
        partIdx += 1; await env.CONFIG_KV.put(idxKey, String(partIdx));
        await put(wkKey(partIdx), JSON.stringify(weeklyAdd));
      }

      // mark shard presence (list of {year, category})
      const shardList = await kvGetJSON(env.CONFIG_KV, SHARD_LIST_FULL, []);
      if (!shardList.find(s => s.year === w.year && s.category === w.category)) {
        shardList.push({ year: w.year, category: w.category });
        await kvPutJSON(env.CONFIG_KV, SHARD_LIST_FULL, shardList);
      }

      // league complete → advance
      i += 1;
      processedThisCall += 1;
      state = { i, stage: "league", weekPtr: 1, ownersMap: null, weeklyRosters: {}, leagueName: null };
      await env.CONFIG_KV.put(CURSOR_KEY, String(i));
      await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);

      // keep an eye on budgets between leagues
      maybePause(startedAt);
    }
  }

  const done = i >= work.length;
  return { manifest, cursor: done ? null : { i }, done };
}
