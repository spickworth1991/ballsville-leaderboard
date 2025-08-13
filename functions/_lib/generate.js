// functions/_lib/generate.js
import { LEAGUE_MAP } from "./league_map.js";

// ---- Tunables ----
const RETRIES = 3;
const MAX_WEEKS = 18;
const SUBREQ_BUDGET = 38;          // under CF subrequest cap
const MAX_CHUNK = 23 * 1024 * 1024; // ~23 MiB per weekly part
const CURSOR_KEY = "run_cursor_v1";
const WEEKLY_PART_IDX_KEY = "weekly_part_idx_v1";

// ---- Subrequest counter ----
let subreqCount = 0;
function tickSubreq() {
  subreqCount++;
  if (subreqCount >= SUBREQ_BUDGET) {
    const err = new Error("PAUSE"); err.name = "PAUSE"; throw err;
  }
}

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

// Build a flat list of work so we can cursor by simple index
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

// --------- R2 helpers ----------
async function r2GetJSON(bucket, key, fallback = {}) {
  const obj = await bucket.get(key);
  if (!obj) return fallback;
  const txt = await obj.text();
  try { return JSON.parse(txt); } catch { return fallback; }
}
function sizeOfJSON(obj) {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

// --------- Merge helpers ----------
function uniqPush(arr, item, keyFn) {
  const key = keyFn(item);
  if (!arr.__idx) arr.__idx = new Map();
  if (!arr.__idx.has(key)) {
    arr.__idx.set(key, arr.length);
    arr.push(item);
  } else {
    // merge totals/weekly if re-encountered
    const idx = arr.__idx.get(key);
    const ex = arr[idx];
    ex.total = item.total ?? ex.total ?? 0;
    ex.weekly = { ...(ex.weekly || {}), ...(item.weekly || {}) };
    if (item.latestRoster) ex.latestRoster = item.latestRoster;
    ex.draftSlot = ex.draftSlot ?? item.draftSlot ?? null;
  }
}

function mergeLeaderboards(existing, add) {
  const out = { ...(existing || {}) };
  for (const [year, cats] of Object.entries(add || {})) {
    out[year] ??= {};
    for (const [cat, payload] of Object.entries(cats)) {
      const src = payload || {};
      const dst = (out[year][cat] ??= {
        name: src.name || "",
        weeks: [],
        owners: [],
        divisions: [],
        leaguesByDivision: {}
      });

      // name (keep first non-empty)
      if (!dst.name && src.name) dst.name = src.name;

      // weeks (union, numeric sort)
      const wk = new Set([...(dst.weeks || []), ...(src.weeks || [])]);
      dst.weeks = [...wk].map(Number).sort((a,b)=>a-b);

      // divisions + leaguesByDivision (union)
      const divSet = new Set([...(dst.divisions || []), ...(src.divisions || [])]);
      dst.divisions = [...divSet];
      dst.leaguesByDivision ??= {};
      for (const [div, list] of Object.entries(src.leaguesByDivision || {})) {
        dst.leaguesByDivision[div] ??= [];
        const set = new Set(dst.leaguesByDivision[div]);
        (list || []).forEach(name => set.add(name));
        dst.leaguesByDivision[div] = [...set];
      }

      // owners (merge by ownerName + leagueName)
      dst.owners ??= [];
      for (const o of (src.owners || [])) {
        uniqPush(dst.owners, o, x => `${x.leagueName}::${x.ownerName}`);
      }
    }
  }
  // cleanup helper index
  for (const y of Object.values(out)) {
    for (const c of Object.values(y)) {
      if (Array.isArray(c.owners) && c.owners.__idx) delete c.owners.__idx;
    }
  }
  return out;
}

function mergeWeekly(existing, add) {
  // structure: { [year]: { [category]: { [leagueName]: weeklyRosters } } }
  const out = { ...(existing || {}) };
  for (const [year, cats] of Object.entries(add || {})) {
    out[year] ??= {};
    for (const [cat, leagues] of Object.entries(cats || {})) {
      out[year][cat] ??= {};
      for (const [leagueName, weeklyRosters] of Object.entries(leagues || {})) {
        const dst = (out[year][cat][leagueName] ??= {});
        // shallow overwrite of weeks is fine (latest wins)
        Object.assign(dst, weeklyRosters || {});
      }
    }
  }
  return out;
}

// --------- Main generator ----------
export async function generateAll(env, log = () => {}, isCanceled = () => false, startCursor = null) {
  if (!env?.LEADERBOARDS?.put) throw new Error("LEADERBOARDS binding missing");
  if (!env?.CONFIG_KV) throw new Error("CONFIG_KV binding missing");

  subreqCount = 0;
  const ac = new AbortController();
  const signal = ac.signal;

  const put = async (key, value) => {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
    const bytes = typeof value === "string"
      ? new TextEncoder().encode(value).length
      : value?.byteLength ?? String(value).length;
    await env.LEADERBOARDS.put(key, value);
    log(`💾 wrote ${key} (${(bytes / 1024 / 1024).toFixed(2)} MiB)`);
    return { key, bytes };
  };

  // cursor is simple index into the flattened list
  const work = buildWorkList();
  let i = Number(await env.CONFIG_KV.get(CURSOR_KEY)) || 0;
  if (startCursor && typeof startCursor.i === 'number') i = startCursor.i;
  if (i < 0) i = 0;
  if (i >= work.length) {
    // nothing to do
    return { manifest: [], cursor: null, done: true };
  }

  // players DB once per *run start* (i === 0)
  if (i === 0) {
    const playersDB = await fetchWithRetry("https://api.sleeper.app/v1/players/nfl", RETRIES, fetch, signal);
    await put("sleeper_players.json", JSON.stringify(playersDB));
  }

  // load players DB for use
  const playersRes = await env.LEADERBOARDS.get("sleeper_players.json");
  if (!playersRes) throw new Error("sleeper_players.json missing in R2");
  const playersDB = JSON.parse(await playersRes.text());

  // Process **one league** per batch (keeps CPU/subrequests low)
  const w = work[i];
  const base = `https://api.sleeper.app/v1/league/${w.leagueId}`;
  const info = await fetchWithRetry(base, RETRIES, fetch, signal);
  const leagueName = info.name;
  log(`Processing ${leagueName} - ${w.division} - ${i+1}/${work.length}`);

  const users   = await fetchWithRetry(`${base}/users`,   RETRIES, fetch, signal);
  const rosters = await fetchWithRetry(`${base}/rosters`, RETRIES, fetch, signal);
  const userMap = {}; users.forEach(u => userMap[u.user_id] = u.display_name);
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
  } catch { /* ignore draft errors */ }

  const matchupsByWeek = {};
  for (let week = 1; week <= MAX_WEEKS; week++) {
    const ms = await fetchWithRetry(`${base}/matchups/${week}`, RETRIES, fetch, signal);
    if (!ms?.length) break;
    matchupsByWeek[week] = ms;
  }
  const latestWeek = findLatestWeek(matchupsByWeek);
  const latestMatchups = latestWeek ? matchupsByWeek[latestWeek] : [];

  const ownersByName = new Map();
  const ensureOwner = (name) => {
    if (!ownersByName.has(name)) ownersByName.set(name, {
      ownerName: name, leagueName, division: w.division, draftSlot: null,
      weekly: {}, total: 0
    });
    return ownersByName.get(name);
  };

  // weekly rosters and owner weekly scores
  const weeklyRosters = {};
  for (const [week, ms] of Object.entries(matchupsByWeek)) {
    weeklyRosters[week] = [];
    ms.forEach(m => {
      const ownerId = rosterMap[m.roster_id];
      if (!ownerId) return;
      const name = userMap[ownerId];
      const starters = (m.starters || []).map((id, i) => ({
        id, name: playersDB[id]?.full_name || id, points: m.starters_points?.[i] || 0
      }));
      const bench = Object.keys(m.players_points || {})
        .filter(id => !m.starters?.includes(id))
        .map(id => ({ id, name: playersDB[id]?.full_name || id, points: m.players_points[id] }));
      weeklyRosters[week].push({ ownerName: name, starters, bench });
      // weekly total
      const pts = (m.starters_points || []).reduce((a,b)=>a+b,0);
      const o = ensureOwner(name);
      o.weekly[week] = Number(pts.toFixed(2));
      o.draftSlot = o.draftSlot ?? (draftSlotMap[ownerId] || null);
    });
  }

  // season totals
  rosters.forEach(r => {
    const ownerId = r.owner_id;
    if (!ownerId) return;
    const name = userMap[ownerId];
    const total = parseFloat(`${r.settings.fpts}.${String(r.settings.fpts_decimal).padStart(2,"0")}`);
    const o = ensureOwner(name);
    o.total = total;
    o.draftSlot = o.draftSlot ?? (draftSlotMap[ownerId] || null);
  });

  // latest roster snapshot
  if (latestMatchups.length) {
    for (const o of ownersByName.values()) {
      const m = latestMatchups.find(mx => userMap[rosterMap[mx.roster_id]] === o.ownerName);
      if (!m) continue;
      const starters = (m.starters || []).map((id, i) => ({
        id, name: playersDB[id]?.full_name || id, points: m.starters_points?.[i] || 0
      }));
      const bench = Object.keys(m.players_points || {})
        .filter(id => !m.starters?.includes(id))
        .map(id => ({ id, name: playersDB[id]?.full_name || id, points: m.players_points[id] }));
      o.latestRoster = { week: latestWeek, starters, bench };
    }
  }

  // ---------- Build batch payloads ----------
  const owners = [...ownersByName.values()];
  const batchFull = {
    [w.year]: {
      [w.category]: {
        name: w.displayName,
        weeks: [...new Set(owners.flatMap(o => Object.keys(o.weekly)))].map(Number).sort((a,b)=>a-b),
        owners,
        divisions: Object.keys(LEAGUE_MAP[w.year][w.category].divisions),
        leaguesByDivision: { [w.division]: [leagueName] }
      }
    }
  };
  const batchWeekly = { [w.year]: { [w.category]: { [leagueName]: weeklyRosters } } };

  // ---------- MERGE to R2 cumulatively ----------
  // leaderboards.json
  const existingFull = await r2GetJSON(env.LEADERBOARDS, "leaderboards.json", {});
  const mergedFull = mergeLeaderboards(existingFull, batchFull);
  await put("leaderboards.json", JSON.stringify(mergedFull, null, 2));

  // weekly parts: append into current part until threshold, then roll
  let partIdx = Number(await env.CONFIG_KV.get(WEEKLY_PART_IDX_KEY)) || 1;
  const partKey = (n) => `weekly_rosters_part${n}.json`;

  // load current part (or empty)
  const curPartObj = await r2GetJSON(env.LEADERBOARDS, partKey(partIdx), {});
  const mergedWeeklyAttempt = mergeWeekly(curPartObj, batchWeekly);
  const mergedBytes = sizeOfJSON(mergedWeeklyAttempt);

  if (mergedBytes <= MAX_CHUNK) {
    await put(partKey(partIdx), JSON.stringify(mergedWeeklyAttempt));
  } else {
    // roll: start a new part with just this batch’s weekly data
    partIdx += 1;
    await env.CONFIG_KV.put(WEEKLY_PART_IDX_KEY, String(partIdx));
    await put(partKey(partIdx), JSON.stringify(batchWeekly));
  }

  // ---------- Advance cursor ----------
  const nextI = i + 1;
  await env.CONFIG_KV.put(CURSOR_KEY, String(nextI));

  // If we’re still within budget, ask the caller to pause & reconnect; if finished, say done.
  const finished = nextI >= work.length;
  return {
    manifest: [
      { key: "leaderboards.json", bytes: sizeOfJSON(mergedFull) },
      { key: partKey(partIdx),   bytes: sizeOfJSON(await r2GetJSON(env.LEADERBOARDS, partKey(partIdx), {})) }
    ],
    cursor: finished ? null : { i: nextI },
    done: finished
  };
}
