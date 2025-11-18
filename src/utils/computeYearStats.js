// /utils/computeYearStats.js
export function computeYearStats(leaderboards, perModeMinSizes = {}) {
  // default minimum roster count per mode (override by passing perModeMinSizes in Provider if needed)
  const defaults = {
    big_game: 10,
    mini_game: 12,
    redraft: 12,
    redraft_2025: 12, // example
    triathlon: 12,
    dynasty: 12,
  };
  const minByMode = { ...defaults, ...perModeMinSizes };

  const result = {}; // { [year]: { totalTeams, uniqueOwners } }

  Object.entries(leaderboards).forEach(([year, modesObj]) => {
    let teams = 0;
    const owners = new Set();

    Object.entries(modesObj).forEach(([modeKey, block]) => {
      const minSize = minByMode[modeKey] ?? 0;

      // leaguesByDivision: { DivisionName: [leagueName, ...] }
      // owners: [{ ownerName, leagueName, ... }, ...]
      const leaguesInMode = block?.leaguesByDivision || {};
      const ownersInMode = block?.owners || [];

      // group owners by leagueName to know league sizes
      const byLeague = new Map();
      for (const o of ownersInMode) {
        if (!byLeague.has(o.leagueName)) byLeague.set(o.leagueName, []);
        byLeague.get(o.leagueName).push(o);
      }

      // count only “full” leagues
      for (const [leagueName, list] of byLeague.entries()) {
        if (list.length >= minSize) {
          teams += list.length;
          for (const o of list) owners.add(o.ownerName);
        }
      }
    });

    result[year] = { totalTeams: teams, uniqueOwners: owners.size };
  });

  return result;
}
