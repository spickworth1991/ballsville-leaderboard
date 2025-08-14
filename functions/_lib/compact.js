// functions/_lib/compact.js
// Builds the *combined* files your site already reads, from per‑league shards.

const MAX_PART_BYTES = 23 * 1024 * 1024; // ~23 MiB weekly parts

export async function listShardLeagues(env, year, category) {
  const prefix = `leaderboards_shards/${year}/${category}/`;
  const out = [];
  let cursor;
  do {
    const { objects, cursor: next } = await env.LEADERBOARDS.list({ prefix, cursor });
    for (const o of objects) {
      if (!o.key.endsWith(".json")) continue;
      const leagueId = o.key.slice(prefix.length).replace(/\.json$/, "");
      out.push({ key: o.key, leagueId });
    }
    cursor = next;
  } while (cursor);
  return out;
}

export async function compactOne(env, year, category, log = () => {}) {
  // 1) Compact FULL -> leaderboards/{year}/{category}.json
  const leagues = await listShardLeagues(env, year, category);
  const divisionsSet = new Set();
  const owners = [];
  let displayName = "";
  const weeksSet = new Set();
  const leaguesByDivision = {};

  for (const { key } of leagues) {
    const obj = await env.LEADERBOARDS.get(key);
    if (!obj) continue;
    const shard = JSON.parse(await obj.text());

    displayName ||= shard.displayName || "";
    divisionsSet.add(shard.division);
    (leaguesByDivision[shard.division] ||= []).push(shard.leagueName);

    // weeks
    (shard.weeks || []).forEach(wk => weeksSet.add(Number(wk)));

    // owners (merge by leagueName + ownerName)
    for (const o of (shard.owners || [])) {
      owners.push(o);
    }
  }

  const fullCombined = {
    [year]: {
      [category]: {
        name: displayName,
        weeks: Array.from(weeksSet).sort((a,b)=>a-b),
        owners,
        divisions: Array.from(divisionsSet),
        leaguesByDivision
      }
    }
  };

  const fullKey = `leaderboards/${year}/${category}.json`;
  await env.LEADERBOARDS.put(fullKey, JSON.stringify(fullCombined, null, 2));
  log(`💾 wrote ${fullKey}`);

  // 2) Compact WEEKLY -> weekly/{year}/{category}/partN.json
  //    We stream shards and accumulate into size‑bounded parts.
  const weeklyPrefix = `weekly_shards/${year}/${category}/`;
  const weeklyLeagues = [];
  let wcursor;
  do {
    const { objects, cursor: next } = await env.LEADERBOARDS.list({ prefix: weeklyPrefix, cursor: wcursor });
    for (const o of objects) if (o.key.endsWith(".json")) weeklyLeagues.push(o.key);
    wcursor = next;
  } while (wcursor);

  let partIdx = 1;
  let chunk = { [year]: { [category]: {} } };
  let size = new TextEncoder().encode(JSON.stringify(chunk)).length;
  const writePart = async () => {
    const key = `weekly/${year}/${category}/part${partIdx}.json`;
    await env.LEADERBOARDS.put(key, JSON.stringify(chunk));
    log(`💾 wrote ${key}`);
    partIdx += 1;
    chunk = { [year]: { [category]: {} } };
    size = new TextEncoder().encode(JSON.stringify(chunk)).length;
  };

  for (const wkey of weeklyLeagues) {
    const obj = await env.LEADERBOARDS.get(wkey);
    if (!obj) continue;
    const shard = JSON.parse(await obj.text()); // { weekly:{...}, leagueName }
    const leagueName = shard.leagueName;
    const payload = { [year]: { [category]: { [leagueName]: shard.weekly || {} } } };
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;

    if (size + bytes > MAX_PART_BYTES) await writePart();
    Object.assign(chunk[year][category], { [leagueName]: shard.weekly || {} });
    size += bytes;
  }
  // leftover
  if (Object.keys(chunk[year][category]).length > 0) await writePart();

  return { fullKey, partsPrefix: `weekly/${year}/${category}/part*.json` };
}
