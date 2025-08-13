// functions/_lib/generate.js
import { LEAGUE_MAP } from "./league_map.js";

// --- tiny p-limit (unchanged) ---
function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then((v) => { active--; resolve(v); next(); })
      .catch((e) => { active--; reject(e); next(); });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

const CONCURRENCY = 1;   // keep tiny—subrequest cap is per request, not just concurrent
const RETRIES = 3;
const MAX_WEEKS = 18;

// --- subrequest budget (per HTTP request) ---
// stay well under CF’s ~50 limit; count every outgoing fetch we do
const SUBREQ_BUDGET = 38;
let subreqCount = 0;
function tickSubreq() {
  subreqCount++;
  if (subreqCount >= SUBREQ_BUDGET) {
    const err = new Error("PAUSE");
    err.name = "PAUSE";
    throw err; // caught and surfaced as a clean “pause”
  }
}

// fetch with retry + budget
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

export async function generateAll(env, log = () => {}, isCanceled = () => false) {
  if (!env?.LEADERBOARDS?.put) throw new Error("LEADERBOARDS binding missing");

  // reset budget for this HTTP request
  subreqCount = 0;

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

  // 1) Players DB
  if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
  const playersDB = await fetchWithRetry(
    "https://api.sleeper.app/v1/players/nfl",
    RETRIES,
    fetch,
    signal
  );
  await put("sleeper_players.json", JSON.stringify(playersDB));

  // progress totals (for nice logs)
  const totalLeagues = Object.values(LEAGUE_MAP)
    .flatMap((y) => Object.values(y))
    .flatMap((m) => Object.values(m.divisions).flat()).length;
  let completed = 0;
  const progress = (m) => { completed++; log(`${m}`); }; // keep your existing wording

  async function processLeague(leagueId, division) {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }

    const base = `https://api.sleeper.app/v1/league/${leagueId}`;
    const info = await fetchWithRetry(base, RETRIES, fetch, signal);
    const leagueName = info.name;
    progress(`Processing ${leagueName} - ${completed}/${totalLeagues}`);

    const users = await fetchWithRetry(`${base}/users`, RETRIES, fetch, signal);
    const rosters = await fetchWithRetry(`${base}/rosters`, RETRIES, fetch, signal);
    const userMap = {}; users.forEach((u) => (userMap[u.user_id] = u.display_name));
    const rosterMap = {}; rosters.forEach((r) => (rosterMap[r.roster_id] = r.owner_id));

    const drafts = await fetchWithRetry(`${base}/drafts`, RETRIES, fetch, signal);
    const draftId = drafts?.[0]?.draft_id;
    const draftDetails = draftId
      ? await fetchWithRetry(`https://api.sleeper.app/v1/draft/${draftId}`, RETRIES, fetch, signal)
      : [];
    const draftSlotMap = {};
    draftDetails?.draft_order &&
      Object.entries(draftDetails.draft_order).forEach(([uid, slot]) => { draftSlotMap[uid] = slot; });

    const matchupsByWeek = {};
    for (let week = 1; week <= MAX_WEEKS; week++) {
      if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
      const ms = await fetchWithRetry(`${base}/matchups/${week}`, RETRIES, fetch, signal);
      if (!ms?.length) break;
      matchupsByWeek[week] = ms;
    }

    const latestWeek = findLatestWeek(matchupsByWeek);
    const latestMatchups = latestWeek ? matchupsByWeek[latestWeek] : [];

    // owners/weekly
    const owners = [];
    const weeklyRosters = {};

    for (const [week, ms] of Object.entries(matchupsByWeek)) {
      if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
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

    // latest roster snapshot
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

  // 2) Build data (stops cleanly when we near the subrequest cap)
  const fullData = {};
  const weeklyData = {};

  try {
    for (const [year, categories] of Object.entries(LEAGUE_MAP)) {
      if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }

      fullData[year] = fullData[year] || {};
      weeklyData[year] = weeklyData[year] || {};

      for (const [category, details] of Object.entries(categories)) {
        if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }

        const catFull = fullData[year][category] || {
          name: details.name,
          weeks: [],
          owners: [],
          divisions: Object.keys(details.divisions),
          leaguesByDivision: {},
        };
        fullData[year][category] = catFull;
        weeklyData[year][category] = weeklyData[year][category] || {};

        for (const [division, leagues] of Object.entries(details.divisions)) {
          // ensure array to avoid .push on non-array
          if (!Array.isArray(catFull.leaguesByDivision[division])) {
            catFull.leaguesByDivision[division] = [];
          }

          for (const leagueId of leagues) {
            // do one league at a time (also keeps subrequests predictable)
            const r = await limit(() => processLeague(leagueId, division));
            catFull.owners.push(...r.owners);
            catFull.leaguesByDivision[division].push(r.leagueName);
            weeklyData[year][category][r.leagueName] = r.weeklyRosters;

            // recompute weeks for this category (based on what we’ve seen this batch)
            const weeks = [
              ...new Set(catFull.owners.flatMap((o) => Object.keys(o.weekly)))
            ].sort((a, b) => a - b);
            catFull.weeks = weeks.map(Number);
          }
        }
      }
    }
  } catch (e) {
    if (e?.name === "PAUSE") {
      log("⏸ Pausing to avoid subrequest cap; run Live again to continue.");
    } else {
      throw e;
    }
  }

  // 3) Write leaderboards.json (whatever we have so far is valid JSON)
  // If the request paused early, this will be a partial (still helpful for debugging / preview).
  await put("leaderboards.json", JSON.stringify(fullData, null, 2));

  // 4) Chunk weekly data
  const MAX_CHUNK = 23 * 1024 * 1024;
  let idx = 1, chunk = {}, size = 0;

  const writePart = async () => {
    await put(`weekly_rosters_part${idx}.json`, JSON.stringify(chunk));
    log(`✅ Wrote part ${idx} (~${(size / 1024 / 1024).toFixed(2)} MiB)`);
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
        // split by league if needed
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

  return { manifest };
}
