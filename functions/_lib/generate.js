// functions/_lib/generate.js
import { LEAGUE_MAP } from "./league_map.js";

// ---- Tunables ----
const RETRIES = 3;
const MAX_WEEKS = 18;
const SUBREQ_BUDGET = 24;              // keep small so "init + 1 week" always fits comfortably
const MAX_CHUNK = 23 * 1024 * 1024;    // ~23 MiB weekly part

// KV keys
const CURSOR_KEY        = "run_cursor_v3";   // global league index
const RUN_STATE_KEY     = "run_state_v3";    // per-league stage/progress
const SHARD_LIST_FULL   = "shard_list_full_v2"; // [{year,category}...]

// ---- Subrequest counter ----
let subreqCount = 0;
function tickSubreq() {
  if (++subreqCount >= SUBREQ_BUDGET) {
    const e = new Error("PAUSE");
    e.name = "PAUSE";
    throw e;
  }
}

async function fetchWithRetry(url, retries = RETRIES, f = fetch, signal) {
  for (let i = 0; i < retries; i++) {
    if (signal?.aborted) throw new Error("Canceled");
    tickSubreq();
    const res = await f(url, signal ? { signal } : undefined);
    if (res.ok) return res.json();
    if (i === retries - 1) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
}

const findLatestWeek = (map) => {
  const weeks = Object.keys(map).map(Number);
  return weeks.length ? Math.max(...weeks) : null;
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

function sizeOfJSON(obj) { return new TextEncoder().encode(JSON.stringify(obj)).length; }

async function r2GetJSON(bucket, key, fallback = {}) {
  const obj = await bucket.get(key);
  if (!obj) return fallback;
  const txt = await obj.text();
  try { return JSON.parse(txt); } catch { return fallback; }
}
async function kvGetJSON(kv, key, fallback = {}) {
  const txt = await kv.get(key);
  if (!txt) return fallback;
  try { return JSON.parse(txt); } catch { return fallback; }
}
async function kvPutJSON(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

// ---------- Merge helpers ----------
function uniqPushOwner(arr, item) {
  if (!arr.__idx) arr.__idx = new Map();
  const key = `${item.leagueName}::${item.ownerName}`;
  if (!arr.__idx.has(key)) {
    arr.__idx.set(key, arr.length);
    arr.push(item);
  } else {
    const ex = arr[arr.__idx.get(key)];
    ex.total = item.total ?? ex.total ?? 0;
    ex.weekly = { ...(ex.weekly || {}), ...(item.weekly || {}) };
    if (item.latestRoster) ex.latestRoster = item.latestRoster;
    ex.draftSlot = ex.draftSlot ?? item.draftSlot ?? null;
  }
}

function mergeShardFull(existing, add, year, category, displayName, divisionsList) {
  const dst = existing[year]?.[category] ?? {
    name: displayName, weeks: [], owners: [], divisions: divisionsList, leaguesByDivision: {}
  };
  const src = add[year][category];

  const wk = new Set([...(dst.weeks || []), ...(src.weeks || [])]);
  dst.weeks = [...wk].map(Number).sort((a, b) => a - b);

  dst.divisions = Array.from(new Set([...(dst.divisions || []), ...divisionsList]));
  dst.leaguesByDivision ??= {};
  for (const [div, names] of Object.entries(src.leaguesByDivision || {})) {
    dst.leaguesByDivision[div] ??= [];
    const s = new Set(dst.leaguesByDivision[div]);
    (names || []).forEach((n) => s.add(n));
    dst.leaguesByDivision[div] = [...s];
  }

  dst.owners ??= [];
  for (const o of (src.owners || [])) uniqPushOwner(dst.owners, o);
  if (dst.owners.__idx) delete dst.owners.__idx;

  return { [year]: { [category]: dst } };
}

function mergeWeeklyShard(existing, add, year, category) {
  const dst = existing[year]?.[category] ?? {};
  const src = add[year][category] || {};
  for (const [leagueName, weekly] of Object.entries(src)) {
    dst[leagueName] = { ...(dst[leagueName] || {}), ...(weekly || {}) };
  }
  return { [year]: { [category]: dst } };
}

// ---------- Main ----------
export async function generateAll(env, log = () => {}, isCanceled = () => false) {
  if (!env?.LEADERBOARDS?.put) throw new Error("LEADERBOARDS binding missing");
  if (!env?.CONFIG_KV) throw new Error("CONFIG_KV binding missing");

  subreqCount = 0;
  const ac = new AbortController();
  const signal = ac.signal;
  const manifest = [];

  const put = async (key, value) => {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
    const bytes = typeof value === "string" ? new TextEncoder().encode(value).length : value?.byteLength ?? String(value).length;
    await env.LEADERBOARDS.put(key, value);
    log(`💾 wrote ${key} (${(bytes / 1024 / 1024).toFixed(2)} MiB)`);
    manifest.push({ key, bytes });
    return { key, bytes };
  };

  const work = buildWorkList();

  // global index
  let i = Number(await env.CONFIG_KV.get(CURSOR_KEY)) || 0;
  if (i >= work.length) return { manifest, cursor: null, done: true };

  // Ensure players DB (once; or if missing)
  const playersObj = await env.LEADERBOARDS.get("sleeper_players.json");
  if (!playersObj) {
    const playersDB = await fetchWithRetry("https://api.sleeper.app/v1/players/nfl", RETRIES, fetch, signal);
    await put("sleeper_players.json", JSON.stringify(playersDB));
  }
  const playersDB = JSON.parse(await (await env.LEADERBOARDS.get("sleeper_players.json")).text());

  // load / seed run-state
  let state = await kvGetJSON(env.CONFIG_KV, RUN_STATE_KEY, null);
  const w = work[i];

  // (Re)seed state if missing or pointing to a different league
  if (!state || state.i !== i || state.leagueId !== w.leagueId) {
    state = {
      i,
      stage: "init",
      year: w.year,
      category: w.category,
      division: w.division,
      displayName: w.displayName,
      leagueId: w.leagueId,
      leagueName: null,
      week: 1,
      userMap: null,
      rosterMap: null,
      draftSlotMap: null,
      lastRoster: null // { week, data }
    };
    await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);
  }

  // per-league keys
  const fullKeyFor = (yy, cc) => `leaderboards/${yy}/${cc}.json`;
  const weeklyKeyFor = (yy, cc, part) => `weekly/${yy}/${cc}/part${part}.json`;
  const weeklyPartIdxKey = `WEEKLY_PART_IDX:${w.year}:${w.category}`;

  // one small step per request
  if (state.stage === "init") {
    // fetch league “static” data
    const base = `https://api.sleeper.app/v1/league/${w.leagueId}`;
    const info    = await fetchWithRetry(base, RETRIES, fetch, signal);
    const users   = await fetchWithRetry(`${base}/users`,   RETRIES, fetch, signal);
    const rosters = await fetchWithRetry(`${base}/rosters`, RETRIES, fetch, signal);

    const userMap   = {}; users.forEach(u => userMap[u.user_id] = u.display_name);
    const rosterMap = {}; rosters.forEach(r => rosterMap[r.roster_id] = r.owner_id);

    let draftSlotMap = {};
    try {
      const drafts = await fetchWithRetry(`${base}/drafts`, RETRIES, fetch, signal);
      const draftId = drafts?.[0]?.draft_id;
      if (draftId) {
        const draftDetails = await fetchWithRetry(`https://api.sleeper.app/v1/draft/${draftId}`, RETRIES, fetch, signal);
        if (draftDetails?.draft_order) {
          Object.entries(draftDetails.draft_order).forEach(([uid, slot]) => { draftSlotMap[uid] = slot; });
        }
      }
    } catch { /* ignore draft fetch errors */ }

    state.leagueName = info.name;
    state.userMap = userMap;
    state.rosterMap = rosterMap;
    state.draftSlotMap = draftSlotMap;
    state.stage = "week"; // start week scanning at state.week (1)
    await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);

    log(`Processing ${state.leagueName} - ${w.division} - ${w.displayName} - ${i+1}/${work.length}`);
    return { manifest, cursor: { i }, done: false }; // tell caller to reconnect
  }

  if (state.stage === "week") {
    const base = `https://api.sleeper.app/v1/league/${w.leagueId}`;
    // fetch this week
    const ms = await fetchWithRetry(`${base}/matchups/${state.week}`, RETRIES, fetch, signal);

    if (!ms || !ms.length) {
      // no more weeks → move to totals
      state.stage = "totals";
      await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);
      return { manifest, cursor: { i }, done: false };
    }

    // build weekly roster & owner weekly points for JUST this week
    const weeklyRosters = [];
    const ownersThisWeek = [];

    for (const m of ms) {
      const ownerId = state.rosterMap[m.roster_id];
      if (!ownerId) continue;
      const name = state.userMap[ownerId];

      const starters = (m.starters || []).map((id, idx) => ({
        id, name: playersDB[id]?.full_name || id, points: m.starters_points?.[idx] || 0
      }));
      const bench = Object.keys(m.players_points || {})
        .filter(id => !m.starters?.includes(id))
        .map(id => ({ id, name: playersDB[id]?.full_name || id, points: m.players_points[id] }));

      weeklyRosters.push({ ownerName: name, starters, bench });

      const pts = (m.starters_points || []).reduce((a,b)=>a+b,0);
      ownersThisWeek.push({
        ownerName: name,
        leagueName: state.leagueName,
        division: w.division,
        draftSlot: state.draftSlotMap[ownerId] || null,
        weekly: { [state.week]: Number(pts.toFixed(2)) },
        total: 0
      });
    }

    // write FULL shard merge (weeks union + per-week owner points)
    const divisionsList = Object.keys(LEAGUE_MAP[w.year][w.category].divisions);
    const shardFullAdd = {
      [w.year]: {
        [w.category]: {
          name: w.displayName,
          weeks: [state.week],
          owners: ownersThisWeek,
          divisions: divisionsList,
          leaguesByDivision: { [w.division]: [state.leagueName] }
        }
      }
    };
    const fullKey = fullKeyFor(w.year, w.category);
    const existingFullShard = await r2GetJSON(env.LEADERBOARDS, fullKey, { [w.year]: { [w.category]: undefined } });
    const mergedFullShard = mergeShardFull(existingFullShard, shardFullAdd, w.year, w.category, w.displayName, divisionsList);
    await put(fullKey, JSON.stringify(mergedFullShard, null, 2));

    // write WEEKLY shard (only this week for this league)
    let partIdx = Number(await env.CONFIG_KV.get(weeklyPartIdxKey)) || 1;
    const weeklyKey = (n) => weeklyKeyFor(w.year, w.category, n);

    const curPart = await r2GetJSON(env.LEADERBOARDS, weeklyKey(partIdx), { [w.year]: { [w.category]: {} } });
    const shardWeeklyAdd = { [w.year]: { [w.category]: { [state.leagueName]: { [state.week]: weeklyRosters } } } };
    const attempt = mergeWeeklyShard(curPart, shardWeeklyAdd, w.year, w.category);
    if (sizeOfJSON(attempt) <= MAX_CHUNK) {
      await put(weeklyKey(partIdx), JSON.stringify(attempt));
    } else {
      partIdx += 1;
      await env.CONFIG_KV.put(weeklyPartIdxKey, String(partIdx));
      await put(weeklyKey(partIdx), JSON.stringify({ [w.year]: { [w.category]: { [state.leagueName]: { [state.week]: weeklyRosters } } } }));
    }

    // remember last roster snapshot so we can set latestRoster later
    state.lastRoster = { week: state.week, data: weeklyRosters };
    state.week += 1;
    await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);

    return { manifest, cursor: { i }, done: false };
  }

  if (state.stage === "totals") {
    // season totals (no external fetches)
    // Recreate totals from the roster settings we cached in "init"
    // We didn't store the full rosters array; totals are not in state.
    // Simpler: fetch rosters one more time (small + within budget)
    const base = `https://api.sleeper.app/v1/league/${w.leagueId}`;
    const rosters = await fetchWithRetry(`${base}/rosters`, RETRIES, fetch, signal);

    const ownersTotals = [];
    for (const r of rosters) {
      const ownerId = r.owner_id; if (!ownerId) continue;
      const name = state.userMap[ownerId];
      const total = parseFloat(`${r.settings.fpts}.${String(r.settings.fpts_decimal).padStart(2, "0")}`);
      ownersTotals.push({
        ownerName: name,
        leagueName: state.leagueName,
        division: w.division,
        draftSlot: state.draftSlotMap[ownerId] || null,
        weekly: {}, // merged with existing
        total
      });
    }

    const divisionsList = Object.keys(LEAGUE_MAP[w.year][w.category].divisions);
    const shardFullAdd = {
      [w.year]: {
        [w.category]: {
          name: w.displayName,
          weeks: [], // none added here
          owners: ownersTotals,
          divisions: divisionsList,
          leaguesByDivision: { [w.division]: [state.leagueName] }
        }
      }
    };

    const fullKey = fullKeyFor(w.year, w.category);
    const existingFullShard = await r2GetJSON(env.LEADERBOARDS, fullKey, { [w.year]: { [w.category]: undefined } });
    const mergedFullShard = mergeShardFull(existingFullShard, shardFullAdd, w.year, w.category, w.displayName, divisionsList);
    await put(fullKey, JSON.stringify(mergedFullShard, null, 2));

    state.stage = "latest";
    await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);
    return { manifest, cursor: { i }, done: false };
  }

  if (state.stage === "latest") {
    // attach latestRoster from last processed week (captured in state)
    if (state.lastRoster && state.lastRoster.data && state.lastRoster.week != null) {
      const ownersWithLatest = state.lastRoster.data.map(entry => ({
        ownerName: entry.ownerName,
        leagueName: state.leagueName,
        division: w.division,
        draftSlot: null,
        weekly: {},
        total: 0,
        latestRoster: { week: state.lastRoster.week, starters: entry.starters, bench: entry.bench }
      }));

      const divisionsList = Object.keys(LEAGUE_MAP[w.year][w.category].divisions);
      const shardFullAdd = {
        [w.year]: {
          [w.category]: {
            name: w.displayName,
            weeks: [], owners: ownersWithLatest,
            divisions: divisionsList,
            leaguesByDivision: { [w.division]: [state.leagueName] }
          }
        }
      };

      const fullKey = fullKeyFor(w.year, w.category);
      const existingFullShard = await r2GetJSON(env.LEADERBOARDS, fullKey, { [w.year]: { [w.category]: undefined } });
      const mergedFullShard = mergeShardFull(existingFullShard, shardFullAdd, w.year, w.category, w.displayName, divisionsList);
      await put(fullKey, JSON.stringify(mergedFullShard, null, 2));
    }

    state.stage = "advance";
    await kvPutJSON(env.CONFIG_KV, RUN_STATE_KEY, state);
    return { manifest, cursor: { i }, done: false };
  }

  // advance to next league
  if (state.stage === "advance") {
    // record shard presence (for top-level indexes if you want them later)
    const shardList = await kvGetJSON(env.CONFIG_KV, SHARD_LIST_FULL, []);
    if (!shardList.find(s => s.year === w.year && s.category === w.category)) {
      shardList.push({ year: w.year, category: w.category });
      await kvPutJSON(env.CONFIG_KV, SHARD_LIST_FULL, shardList);
    }

    const nextI = i + 1;
    await env.CONFIG_KV.put(CURSOR_KEY, String(nextI));
    await env.CONFIG_KV.delete(RUN_STATE_KEY); // clear per-league scratch

    const done = nextI >= work.length;
    return { manifest, cursor: done ? null : { i: nextI }, done };
  }

  // fallback
  return { manifest, cursor: { i }, done: false };
}
