// functions/_lib/generate.js
import { LEAGUE_MAP } from "./league_map.js";

/** Tunables */
const RETRIES = 3;
const MAX_WEEKS = 18;
const MAX_LEAGUES_PER_INVOCATION = 8;

// Subrequests (Free plan has 50/request). Keep our own budget smaller.
const SUBREQ_BUDGET = 48;
const SUBREQ_RESERVE_PER_LEAGUE = 24;  // fetches + R2/KV writes worst-case
const FINAL_RESERVE = 6;               // safe room for final KV put etc.

// Soft wall time: end request proactively and rotate
const SOFT_WALL_MS = 20_000;

/** Output sizing */
const MAX_CHUNK = 23 * 1024 * 1024; // ~23 MiB weekly part

/** KV keys */
const CURSOR_KEY = "run_cursor_rotate_v1";
const SHARD_LIST_FULL = "shard_list_full_v1"; // JSON: [{year,category}...]

/** Subrequest counter */
let subreqCount = 0;
function tickSubreq() {
  if (++subreqCount >= SUBREQ_BUDGET) {
    const e = new Error("ROTATE"); e.name = "ROTATE"; throw e;
  }
}
const remainingBudget = () => Math.max(0, SUBREQ_BUDGET - subreqCount);

/** Utils */
async function fetchWithRetry(url, retries = RETRIES, f = fetch, signal) {
  for (let i = 0; i < retries; i++) {
    if (signal?.aborted) throw new Error("Canceled");
    tickSubreq();
    const res = await f(url, signal ? { signal } : undefined);
    if (res.ok) return res.json();
    if (i === retries - 1) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await new Promise(r => setTimeout(r, 500 * (i + 1)));
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
  tickSubreq();
  const obj = await bucket.get(key);
  if (!obj) return fallback;
  const txt = await obj.text();
  try { return JSON.parse(txt); } catch { return fallback; }
}

async function kvGetJSON(kv, key, fallback = {}) {
  tickSubreq();
  const txt = await kv.get(key);
  if (!txt) return fallback;
  try { return JSON.parse(txt); } catch { return fallback; }
}

function uniqPushOwner(arr, item) {
  if (!arr.__idx) arr.__idx = new Map();
  const key = `${item.leagueName}::${item.ownerName}`;
  if (!arr.__idx.has(key)) { arr.__idx.set(key, arr.length); arr.push(item); }
  else {
    const ex = arr[arr.__idx.get(key)];
    ex.total = item.total ?? ex.total ?? 0;
    ex.weekly = { ...(ex.weekly||{}), ...(item.weekly||{}) };
    if (item.latestRoster) ex.latestRoster = item.latestRoster;
    ex.draftSlot = ex.draftSlot ?? item.draftSlot ?? null;
  }
}

function mergeShardFull(existing, add, year, category, displayName, divisionsList) {
  const dst = existing[year]?.[category] ?? {
    name: displayName, weeks: [], owners: [], divisions: divisionsList, leaguesByDivision: {}
  };
  const src = add[year][category];

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

/** Main */
export async function generateAll(env, log = () => {}, isCanceled = () => false, startCursor = null) {
  if (!env?.LEADERBOARDS?.put) throw new Error("LEADERBOARDS binding missing");
  if (!env?.CONFIG_KV) throw new Error("CONFIG_KV binding missing");

  const startTs = Date.now();
  subreqCount = 0;

  const ac = new AbortController();
  const signal = ac.signal;
  const work = buildWorkList();

  // Cursor
  let i = Number(await (async () => { tickSubreq(); return env.CONFIG_KV.get(CURSOR_KEY); })()) || 0;
  if (startCursor && typeof startCursor.i === "number") i = startCursor.i;
  if (i < 0) i = 0;
  if (i >= work.length) return { manifest: [], cursor: null, done: true };

  const putR2 = async (key, value) => {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
    const bytes = typeof value === "string" ? new TextEncoder().encode(value).length : value?.byteLength ?? String(value).length;
    tickSubreq();
    await env.LEADERBOARDS.put(key, value);
    log(`💾 wrote ${key} (${(bytes/1024/1024).toFixed(2)} MiB)`);
    return { key, bytes };
  };

  // Players DB once per run start
  if (i === 0) {
    const playersDB = await fetchWithRetry("https://api.sleeper.app/v1/players/nfl", RETRIES, fetch, signal);
    await putR2("sleeper_players.json", JSON.stringify(playersDB));
  }

  // Load players DB
  tickSubreq();
  const playersRes = await env.LEADERBOARDS.get("sleeper_players.json");
  if (!playersRes) throw new Error("sleeper_players.json missing in R2");
  const playersDB = JSON.parse(await playersRes.text());

  const manifest = [];
  let doneNow = false;
  let leaguesDone = 0;

  // Helper: should we rotate before starting next league?
  const shouldRotate = () => {
    const wall = Date.now() - startTs;
    if (wall >= SOFT_WALL_MS) return true;
    // leave room to finish one more league cleanly
    if (remainingBudget() < (SUBREQ_RESERVE_PER_LEAGUE + FINAL_RESERVE)) return true;
    return false;
  };

  while (i < work.length && leaguesDone < MAX_LEAGUES_PER_INVOCATION) {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
    if (shouldRotate() && leaguesDone > 0) break; // rotate now (after finishing at least one league)

    const w = work[i];

    // If starting a brand-new league, ensure headroom right now
    if (remainingBudget() < (SUBREQ_RESERVE_PER_LEAGUE + FINAL_RESERVE)) break;

    const base = `https://api.sleeper.app/v1/league/${w.leagueId}`;
    const info = await fetchWithRetry(base, RETRIES, fetch, signal);
    const leagueName = info.name;
    log(`Processing ${leagueName} - ${w.division} - ${w.displayName} - ${i+1}/${work.length}`);

    const users   = await fetchWithRetry(`${base}/users`,   RETRIES, fetch, signal);
    const rosters = await fetchWithRetry(`${base}/rosters`, RETRIES, fetch, signal);
    const userMap = {}; users.forEach(u => userMap[u.user_id] = u.display_name);
    const rosterMap = {}; rosters.forEach(r => rosterMap[r.roster_id] = r.owner_id);

    // draft slots (best-effort)
    const draftSlotMap = {};
    try {
      const drafts = await fetchWithRetry(`${base}/drafts`, RETRIES, fetch, signal);
      const draftId = drafts?.[0]?.draft_id;
      if (draftId) {
        const draftDetails = await fetchWithRetry(`https://api.sleeper.app/v1/draft/${draftId}`, RETRIES, fetch, signal);
        if (draftDetails?.draft_order) {
          Object.entries(draftDetails.draft_order).forEach(([uid, slot]) => { draftSlotMap[uid] = slot; });
        }
      }
    } catch {}

    // matchups
    const matchupsByWeek = {};
    for (let week = 1; week <= MAX_WEEKS; week++) {
      const ms = await fetchWithRetry(`${base}/matchups/${week}`, RETRIES, fetch, signal);
      if (!ms?.length) break;
      matchupsByWeek[week] = ms;
    }
    const latestWeek = findLatestWeek(matchupsByWeek);
    const latestMatchups = latestWeek ? matchupsByWeek[latestWeek] : [];

    // owners and weekly
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
        const starters = (m.starters || []).map((id,i)=>({ id, name: playersDB[id]?.full_name || id, points: m.starters_points?.[i] || 0 }));
        const bench = Object.keys(m.players_points || {}).filter(id => !m.starters?.includes(id))
          .map(id => ({ id, name: playersDB[id]?.full_name || id, points: m.players_points[id] }));
        weeklyRosters[week].push({ ownerName: name, starters, bench });
        const pts = (m.starters_points || []).reduce((a,b)=>a+b,0);
        const o = ensureOwner(name); o.weekly[week] = Number(pts.toFixed(2)); o.draftSlot = o.draftSlot ?? (draftSlotMap[ownerId] || null);
      });
    }

    // totals
    rosters.forEach(r => {
      const ownerId = r.owner_id; if (!ownerId) return;
      const name = userMap[ownerId];
      const total = parseFloat(`${r.settings.fpts}.${String(r.settings.fpts_decimal).padStart(2,"0")}`);
      const o = ensureOwner(name); o.total = total; o.draftSlot = o.draftSlot ?? (draftSlotMap[ownerId] || null);
    });

    // latest roster
    if (latestMatchups.length) {
      for (const o of ownersByName.values()) {
        const m = latestMatchups.find(mx => userMap[rosterMap[mx.roster_id]] === o.ownerName); if (!m) continue;
        const starters = (m.starters || []).map((id,i)=>({ id, name: playersDB[id]?.full_name || id, points: m.starters_points?.[i] || 0 }));
        const bench = Object.keys(m.players_points || {}).filter(id => !m.starters?.includes(id))
          .map(id => ({ id, name: playersDB[id]?.full_name || id, points: m.players_points[id] }));
        o.latestRoster = { week: latestWeek, starters, bench };
      }
    }

    const owners = [...ownersByName.values()];
    const divisionsList = Object.keys(LEAGUE_MAP[w.year][w.category].divisions);

    const shardFullAdd = {
      [w.year]: {
        [w.category]: {
          name: w.displayName,
          weeks: [...new Set(owners.flatMap(o => Object.keys(o.weekly)))].map(Number).sort((a,b)=>a-b),
          owners,
          divisions: divisionsList,
          leaguesByDivision: { [w.division]: [info.name] }
        }
      }
    };
    const shardWeeklyAdd = { [w.year]: { [w.category]: { [info.name]: weeklyRosters } } };

    // shard list
    const shardList = await kvGetJSON(env.CONFIG_KV, SHARD_LIST_FULL, []);
    if (!shardList.find(s => s.year === w.year && s.category === w.category)) {
      shardList.push({ year: w.year, category: w.category });
      tickSubreq();
      await env.CONFIG_KV.put(SHARD_LIST_FULL, JSON.stringify(shardList));
    }

    // full shard write
    const fullKey = `leaderboards/${w.year}/${w.category}.json`;
    const existingFullShard = await r2GetJSON(env.LEADERBOARDS, fullKey, { [w.year]: { [w.category]: undefined } });
    const mergedFullShard = mergeShardFull(existingFullShard, shardFullAdd, w.year, w.category, w.displayName, divisionsList);
    await putR2(fullKey, JSON.stringify(mergedFullShard, null, 2));

    // weekly part write/roll
    const weeklyPartIdxKey = `WEEKLY_PART_IDX:${w.year}:${w.category}`;
    tickSubreq();
    let partIdx = Number(await env.CONFIG_KV.get(weeklyPartIdxKey)) || 1;
    const weeklyKey = (n) => `weekly/${w.year}/${w.category}/part${n}.json`;

    const curPart = await r2GetJSON(env.LEADERBOARDS, weeklyKey(partIdx), { [w.year]: { [w.category]: {} } });
    const attempt = mergeWeeklyShard(curPart, shardWeeklyAdd, w.year, w.category);
    if (sizeOfJSON(attempt) <= MAX_CHUNK) {
      await putR2(weeklyKey(partIdx), JSON.stringify(attempt));
    } else {
      partIdx += 1;
      tickSubreq();
      await env.CONFIG_KV.put(weeklyPartIdxKey, String(partIdx));
      await putR2(weeklyKey(partIdx), JSON.stringify(shardWeeklyAdd));
    }

    // advance cursor after finishing this league
    i += 1;
    leaguesDone += 1;

    // update cursor now (so reconnection never replays)
    tickSubreq();
    await env.CONFIG_KV.put(CURSOR_KEY, String(i));

    // If we’re near the wall/budget, rotate now
    if (shouldRotate()) break;
  }

  if (i >= work.length) doneNow = true;

  return {
    manifest: [],
    cursor: doneNow ? null : { i },
    done: doneNow,
    rotate: !doneNow && (Date.now() - startTs >= SOFT_WALL_MS || remainingBudget() < FINAL_RESERVE)
  };
}
