import pLimit from "p-limit";
import { LEAGUE_MAP } from "./league_map";

const CONCURRENCY = 5;
const RETRIES = 3;
const MAX_WEEKS = 18;

async function fetchWithRetry(url, retries = RETRIES, f = fetch, signal) {
  for (let i = 0; i < retries; i++) {
    if (signal?.aborted) throw new Error("Canceled");
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

  // progress counters
  let completed = 0;
  const totalLeagues = Object.values(LEAGUE_MAP)
    .flatMap((y) => Object.values(y))
    .flatMap((m) => Object.values(m.divisions).flat()).length;
  const progress = (m) => { completed++; log(`[${completed}/${totalLeagues}] ${m}`); };

  async function processLeague(leagueId, division) {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }

    const base = `https://api.sleeper.app/v1/league/${leagueId}`;
    const info = await fetchWithRetry(base, RETRIES, fetch, signal);
    const leagueName = info.name;
    progress(`Processing ${leagueName} (${division})`);

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

  // 2) Build data
  if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
  const fullData = {};
  const weeklyData = {};

  for (const [year, categories] of Object.entries(LEAGUE_MAP)) {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }

    fullData[year] = {};
    weeklyData[year] = {};
    for (const [category, details] of Object.entries(categories)) {
      if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }

      const all = [];
      const weeklyCat = {};
      const leaguesByDiv = {};

      for (const [division, leagues] of Object.entries(details.divisions)) {
        if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
        leaguesByDiv[division] = [];

        await Promise.all(
          leagues.map((leagueId) =>
            limit(async () => {
              if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
              const r = await processLeague(leagueId, division);
              leaguesByDiv[division].push(r.leagueName);
              all.push(...r.owners);
              weeklyCat[r.leagueName] = r.weeklyRosters;
            })
          )
        );
      }

      const weeks = [...new Set(all.flatMap((o) => Object.keys(o.weekly)))].sort((a, b) => a - b);
      fullData[year][category] = {
        name: details.name,
        weeks,
        owners: all,
        divisions: Object.keys(details.divisions),
        leaguesByDivision: leaguesByDiv,
      };
      weeklyData[year][category] = weeklyCat;
    }
  }

  // 3) Write leaderboards.json
  if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
  await put("leaderboards.json", JSON.stringify(fullData, null, 2));

  // 4) Chunk weekly data
  const MAX_CHUNK = 23 * 1024 * 1024;
  let idx = 1, chunk = {}, size = 0;

  const writePart = async () => {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
    await put(`weekly_rosters_part${idx}.json`, JSON.stringify(chunk));
    log(`✅ Wrote part ${idx} (~${(size / 1024 / 1024).toFixed(2)} MiB)`);
    idx++; chunk = {}; size = 0;
  };

  for (const year in weeklyData) {
    if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }
    for (const category in weeklyData[year]) {
      if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }

      const cat = weeklyData[year][category];
      const catPayload = { [year]: { [category]: cat } };
      const catBytes = new TextEncoder().encode(JSON.stringify(catPayload)).length;

      if (catBytes <= MAX_CHUNK) {
        if (size + catBytes > MAX_CHUNK && size > 0) await writePart();
        if (!chunk[year]) chunk[year] = {};
        chunk[year][category] = cat;
        size += catBytes;
        continue;
      }

      // split by league if needed
      let bucket = {}, bucketSize = 0;
      const flushBucket = async () => {
        if (!Object.keys(bucket).length) return;
        if (!chunk[year]) chunk[year] = {};
        if (!chunk[year][category]) chunk[year][category] = {};
        Object.assign(chunk[year][category], bucket);
        size += bucketSize;
        bucket = {}; bucketSize = 0;
        if (size > MAX_CHUNK) await writePart();
      };

      for (const leagueName of Object.keys(cat)) {
        if (isCanceled()) { ac.abort(); throw new Error("Canceled"); }

        const leaguePart = { [year]: { [category]: { [leagueName]: cat[leagueName] } } };
        const leagueBytes = new TextEncoder().encode(JSON.stringify(leaguePart)).length;

        if (leagueBytes > MAX_CHUNK) {
          if (size > 0) await writePart();
          chunk = { [year]: { [category]: { [leagueName]: cat[leagueName] } } };
          size = leagueBytes;
          await writePart();
          continue;
        }

        if (size + leagueBytes > MAX_CHUNK && size > 0) await writePart();
        if (bucketSize + leagueBytes > MAX_CHUNK && bucketSize > 0) await flushBucket();

        if (!bucket[year]) bucket[year] = {};
        if (!bucket[year][category]) bucket[year][category] = {};
        bucket[year][category][leagueName] = cat[leagueName];
        bucketSize += leagueBytes;

        if (size + bucketSize >= MAX_CHUNK) await flushBucket();
      }
      await flushBucket();
    }
  }

  if (Object.keys(chunk).length) await writePart();

  return { manifest };
}
