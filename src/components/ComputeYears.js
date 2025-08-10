// src/components/ComputeYears.js

/**
 * Compute totals across an entire year block, honoring per-mode min sizes.
 *
 * @param {object} yearBlock - e.g. leaderboards["2025"]
 * @param {object} perModeMinSizes - { big_game: 8, redraft: 12, ... }
 * @param {number} defaultMinSize - fallback if mode not in perModeMinSizes
 * @returns {{ totalTeams: number, uniqueOwners: number }}
 */
export function computeYearStats(yearBlock, perModeMinSizes = {}, defaultMinSize = 10) {
  if (!yearBlock) return { totalTeams: 0, uniqueOwners: 0 };

  let totalTeams = 0;
  const ownersSeen = new Set();

  for (const [modeKey, modeBlock] of Object.entries(yearBlock)) {
    const owners = modeBlock?.owners || [];
    const minSize = perModeMinSizes[modeKey] ?? defaultMinSize;

    // Group owners by league for this mode
    const ownersByLeague = owners.reduce((acc, o) => {
      const league = o.leagueName || 'Unknown League';
      (acc[league] ||= new Set()).add(o.ownerName);
      return acc;
    }, {});

    // Count only leagues that meet the mode's min size
    Object.values(ownersByLeague).forEach((set) => {
      if (set.size >= minSize) {
        totalTeams += set.size;
        set.forEach((n) => ownersSeen.add(n));
      }
    });
  }

  return { totalTeams, uniqueOwners: ownersSeen.size };
}
