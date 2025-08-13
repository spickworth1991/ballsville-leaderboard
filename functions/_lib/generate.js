// functions/_lib/generate.js
import { LEAGUE_MAP } from "./league_map.js";

// tiny p-limit (we’ll still keep it at 1)
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

const CONCURRENCY = 1;               // one at a time
const RETRIES = 3;
const MAX_WEEKS = 18;

// per-request budgets
const SUBREQ_BUDGET = 40;            // keep safely under CF cap
const MAX_LEAGUES_PER_BATCH = 1;     // <— the key: exactly one per request

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

// flatten worklist
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

  subreqCount = 0; // reset for THIS request

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

  // Phase 0 (first ever batch): cache player DB
  if (i === 0) {
    const playersDB = await fetchWithRetry("https://api.sleeper.app/v1/players/nfl", RETRIES, fetch, signal);
    await put("sleeper_players.json", JSON.stringify(playersDB));
  }

  // load players DB each batch (cheap)
  const playersRes = await env.LEADERBOARDS.get("sleeper_players.json");
  if (!playersRes) throw new Error("sleeper_players.json missing in R2");
  const playersDB = JSON.parse(await playersRes.text());

  // rolling data for THIS one-league batch
  const fullData = {};
  const weeklyData = {};
  const weeksSeenByCat = {}; // {year: {cat: Set(weeks)}}

  async function processLeague(entry) {
    const { leagueId, division } = entry;
    const base = `https://api.sleeper.app/v1/league/${leagueId}`;

    const info = await fetchWithRetry(base, RETRIES, fetch, signal);
    const leagueName = info.name;
    log(`Processing ${leagueName} - ${i + 1}/${work.length}`);

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
    const weeksSeen = new Set();

    for (const [week, ms] of Object.entries(matchupsByWeek)) {
      weeksSeen.add(Number(week));
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

    return { leagueName, owners, weeklyRosters, weeksSeen };
  }

  let processed = 0;

  try {
    for (; i < work.length; i++) {
      if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
      if (processed >= MAX_LEAGUES_PER_BATCH) break; // exactly one

      const w = work[i];

      // batch-local shells
      fullData[w.year] ??= {};
      weeklyData[w.year] ??= {};
      weeksSeenByCat[w.year] ??= {};
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
      weeksSeenByCat[w.year][w.category] ??= new Set();

      // process ONE league
      const r = await limit(() => processLeague(w));
      catFull.owners.push(...r.owners);
      catFull.leaguesByDivision[w.division].push(r.leagueName);
      weeklyData[w.year][w.category][r.leagueName] = r.weeklyRosters;
      r.weeksSeen.forEach((wk) => weeksSeenByCat[w.year][w.category].add(wk));

      processed++;
      i++; // advance cursor to NEXT league index
      break; // safety: we only do one
    }
  } catch (e) {
    if (e?.name !== "PAUSE") throw e; // real error
    // else: deliberate pause due to subrequest budget
  }

  // compute weeks only for touched cat (small)
  for (const [year, cats] of Object.entries(weeksSeenByCat)) {
    for (const [cat, set] of Object.entries(cats)) {
      const arr = Array.from(set).sort((a, b) => a - b);
      if (fullData[year]?.[cat]) fullData[year][cat].weeks = arr;
    }
  }

  // write partials (valid JSON; just the one league’s contribution)
  await put("leaderboards.json", JSON.stringify(fullData, null, 2));

  // chunk weekly (also partial)
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

  const done = finished() || processed === 0;
  return {
    manifest,
    cursor: done ? null : { i },  // next league index
    done,
  };
}
