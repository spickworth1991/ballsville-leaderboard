// functions/_lib/generate.js
import { LEAGUE_MAP } from "./league_map.js";

// tiny p-limit (we still run sequentially to keep subrequests predictable)
function pLimit(concurrency) {
  let active = 0;
  const q = [];
  const next = () => {
    if (active >= concurrency || q.length === 0) return;
    active++;
    const { fn, resolve, reject } = q.shift();
    Promise.resolve()
      .then(fn)
      .then((v) => { active--; resolve(v); next(); })
      .catch((e) => { active--; reject(e); next(); });
  };
  return (fn) => new Promise((resolve, reject) => { q.push({ fn, resolve, reject }); next(); });
}

const CONCURRENCY = 1;
const RETRIES = 3;
const MAX_WEEKS = 18;

// --- per-request subrequest budget ---
const SUBREQ_BUDGET = 38; // well under CF’s ~50 cap
let subreqCount = 0;
function tickSubreq() {
  subreqCount++;
  if (subreqCount >= SUBREQ_BUDGET) {
    const err = new Error("PAUSE");
    err.name = "PAUSE";
    throw err;
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

// Flatten league work so we can keep a simple integer cursor
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

export async function generateAll(env, log = () => {}, isCanceled = () => false, startCursor = null) {
  if (!env?.LEADERBOARDS?.put) throw new Error("LEADERBOARDS binding missing");

  subreqCount = 0; // reset budget for THIS request

  const ac = new AbortController();
  const signal = ac.signal;
  const limit = pLimit(CONCURRENCY);
  const manifest = [];

  const put = async (key, value) => {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value).length
        : value?.byteLength ?? String(value).length;
    await env.LEADERBOARDS.put(key, value);
    manifest.push({ key, bytes });
    log(`💾 wrote ${key} (${(bytes / 1024 / 1024).toFixed(2)} MiB)`);
    return { key, bytes };
  };

  const work = buildWorkList();
  let i = Math.max(0, Number(startCursor?.i || 0));
  const finished = () => i >= work.length;

  // Phase 0 — only on very first batch
  if (i === 0) {
    const playersDB = await fetchWithRetry("https://api.sleeper.app/v1/players/nfl", RETRIES, fetch, signal);
    await put("sleeper_players.json", JSON.stringify(playersDB));
  }

  // Load players DB for this batch
  const playersRes = await env.LEADERBOARDS.get("sleeper_players.json");
  if (!playersRes) throw new Error("sleeper_players.json missing in R2");
  const playersDB = JSON.parse(await playersRes.text());

  // Rolling (this batch only)
  const fullData = {};
  const weeklyData = {};

  async function processLeague(entry) {
    const { leagueId, division } = entry;
    const base = `https://api.sleeper.app/v1/league/${leagueId}`;

    const info = await fetchWithRetry(base, RETRIES, fetch, signal);
    const leagueName = info.name;
    log(`Processing ${leagueName} - ${i}/${work.length}`);

    const users = await fetchWithRetry(`${base}/users`, RETRIES, fetch, signal);
    const rosters = await fetchWithRetry(`${base}/rosters`, RETRIES, fetch, signal);
    const userMap = {}; users.forEach((u) => (userMap[u.user_id] = u.display_name));
    const rosterMap = {}; rosters.forEach((r) => (rosterMap[r.roster_id] = r.owner_id));

    const drafts = await fetchWithRetry(`${base}/drafts`, RETRIES, fetch, signal);
    const draftId = drafts?.[0]?.draft_id;
    const draftDetails = draftId
      ? await fetchWithRetry(`https://api.sleeper.app/v1/draft/${draftId}`, RETRIES, fetch, signal)
      : null;

    const draftSlotMap = {};
    draftDetails?.draft_order &&
      Object.entries(draftDetails.draft_order).forEach(([uid, slot]) => { draftSlotMap[uid] = slot; });

    const matchupsByWeek = {};
    for (let week = 1; week <= MAX_WEEKS; week++) {
      const ms = await fetchWithRetry(`${base}/matchups/${week}`, RETRIES, fetch, signal);
      if (!ms?.length) break;
      matchupsByWeek[week] = ms;
    }

    const latestWeek = findLatestWeek(matchupsByWeek);
    const latestMatchups = latestWeek ? matchupsByWeek[latestWeek] : [];

    const owners = [];
    const weeklyRosters = {};

    for (const [week, ms] of Object.entries(matchupsByWeek)) {
      weeklyRosters[week] = [];
      ms.forEach((m) => {
        const ownerId = rosterMap[m.roster_id];
        if (!ownerId) return;
        const name = userMap[ownerId];

        const starters = (m.starters || []).map((id, i) => ({
          id,
          name: playersDB[id]?.full_name || id,
          points: m.starters_points?.[i] || 0,
        }));

        const bench = Object.keys(m.players_points || {})
          .filter((id) => !m.starters?.includes(id))
          .map((id) => ({
            id,
            name: playersDB[id]?.full_name || id,
            points: m.players_points[id],
          }));

        weeklyRosters[week].push({ ownerName: name, starters, bench });
      });
    }

    // per-week totals
    Object.keys(matchupsByWeek).forEach((week) => {
      matchupsByWeek[week].forEach((m) => {
        const ownerId = rosterMap[m.roster_id];
        if (!ownerId) return;
        const name = userMap[ownerId];
        const pts = (m.starters_points || []).reduce((a, b) => a + b, 0);
        let ex = owners.find((o) => o.ownerName === name);
        if (!ex) {
          ex = { ownerName: name, leagueName, division, draftSlot: draftSlotMap[ownerId] || null, weekly: {}, total: 0 };
          owners.push(ex);
        }
        ex.weekly[week] = Number(pts.toFixed(2));
      });
    });

    // season totals
    rosters.forEach((r) => {
      const ownerId = r.owner_id;
      if (!ownerId) return;
      const name = userMap[ownerId];
      let ex = owners.find((o) => o.ownerName === name);
      if (!ex) {
        ex = { ownerName: name, leagueName, division, draftSlot: draftSlotMap[ownerId] || null, weekly: {}, total: 0 };
        owners.push(ex);
      }
      const total = parseFloat(`${r.settings.fpts}.${String(r.settings.fpts_decimal).padStart(2, "0")}`);
      ex.total = total;
    });

    // latest roster
    owners.forEach((o) => {
      const m = latestMatchups.find((mx) => userMap[rosterMap[mx.roster_id]] === o.ownerName);
      if (!m) return;
      const starters = (m.starters || []).map((id, i) => ({
        id,
        name: playersDB[id]?.full_name || id,
        points: m.starters_points?.[i] || 0,
      }));
      const bench = Object.keys(m.players_points || {})
        .filter((id) => !m.starters?.includes(id))
        .map((id) => ({ id, name: playersDB[id]?.full_name || id, points: m.players_points[id] }));
      o.latestRoster = { week: latestWeek, starters, bench };
    });

    return { leagueName, owners, weeklyRosters };
  }

  // process leagues until we hit budget (or finish)
  try {
    for (; i < work.length; i++) {
      if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
      const w = work[i];

      // ensure containers
      fullData[w.year] ??= {};
      weeklyData[w.year] ??= {};
      if (!fullData[w.year][w.category]) {
        fullData[w.year][w.category] = {
          name: w.displayName,
          weeks: [],
          owners: [],
          divisions: Object.keys(LEAGUE_MAP[w.year][w.category].divisions),
          leaguesByDivision: {},
        };
      }
      const catFull = fullData[w.year][w.category];
      if (!Array.isArray(catFull.leaguesByDivision[w.division])) {
        catFull.leaguesByDivision[w.division] = [];
      }
      weeklyData[w.year][w.category] ??= {};

      // do one league
      const r = await limit(() => processLeague(w));
      catFull.owners.push(...r.owners);
      catFull.leaguesByDivision[w.division].push(r.leagueName);
      weeklyData[w.year][w.category][r.leagueName] = r.weeklyRosters;

      // recompute weeks (for what we’ve seen this batch)
      const weeks = [...new Set(catFull.owners.flatMap((o) => Object.keys(o.weekly)))].sort((a, b) => a - b);
      catFull.weeks = weeks.map(Number);
    }
  } catch (e) {
    if (e?.name !== "PAUSE") throw e; // real error should bubble
    // else: we paused intentionally to avoid the cap
  }

  // Write partial snapshots (valid JSON even if not finished)
  await put("leaderboards.json", JSON.stringify(fullData, null, 2));

  // Chunk weekly data (partial ok)
  const MAX_CHUNK = 23 * 1024 * 1024;
  let idx = 1, chunk = {}, size = 0;
  const writePart = async () => {
    await put(`weekly_rosters_part${idx}.json`, JSON.stringify(chunk));
    idx++; chunk = {}; size = 0;
  };

  for (const year of Object.keys(weeklyData)) {
    for (const cat of Object.keys(weeklyData[year])) {
      const catPayload = { [year]: { [cat]: weeklyData[year][cat] } };
      const catBytes = new TextEncoder().encode(JSON.stringify(catPayload)).length;

      if (catBytes <= MAX_CHUNK) {
        if (size + catBytes > MAX_CHUNK && size > 0) await writePart();
        if (!chunk[year]) chunk[year] = {};
        chunk[year][cat] = weeklyData[year][cat];
        size += catBytes;
      } else {
        for (const leagueName of Object.keys(weeklyData[year][cat])) {
          const leaguePart = { [year]: { [cat]: { [leagueName]: weeklyData[year][cat][leagueName] } } };
          const leagueBytes = new TextEncoder().encode(JSON.stringify(leaguePart)).length;
          if (leagueBytes > MAX_CHUNK) {
            if (size > 0) await writePart();
            chunk = leaguePart; size = leagueBytes;
            await writePart();
            continue;
          }
          if (size + leagueBytes > MAX_CHUNK && size > 0) await writePart();
          if (!chunk[year]) chunk[year] = {};
          if (!chunk[year][cat]) chunk[year][cat] = {};
          Object.assign(chunk[year][cat], { [leagueName]: weeklyData[year][cat][leagueName] });
          size += leagueBytes;
        }
      }
    }
  }
  if (Object.keys(chunk).length) await writePart();

  return {
    manifest,
    cursor: finished() ? null : { i }, // next index to start with on the next request
    done: finished(),
  };
}
