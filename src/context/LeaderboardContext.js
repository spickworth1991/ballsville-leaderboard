// /context/LeaderboardContext.jsx
'use client';
import { createContext, useContext, useMemo } from 'react';

// Simple year stats: total teams (all rows) + unique owners (by name) per year
function computeYearStats(leaderboards, perModeMinSizes) {
  const out = {};
  for (const [year, yearBlock] of Object.entries(leaderboards || {})) {
    let totalTeams = 0;
    const ownerNames = new Set();

    for (const [mode, block] of Object.entries(yearBlock || {})) {
      // optional: skip modes that don't meet a minimum size (if you pass it)
      const min = perModeMinSizes?.[mode];
      const owners = Array.isArray(block?.owners) ? block.owners : [];
      if (min && owners.length < min) continue;

      totalTeams += owners.length;
      owners.forEach(o => ownerNames.add(o.ownerName));
    }

    out[year] = { totalTeams, uniqueOwners: ownerNames.size };
  }
  return out;
}

export const LeaderboardContext = createContext({ statsByYear: {} });

export const LeaderboardProvider = ({ children, leaderboards, perModeMinSizes }) => {
  const statsByYear = useMemo(() => {
    if (!leaderboards || typeof leaderboards !== 'object') return {};
    return computeYearStats(leaderboards, perModeMinSizes);
  }, [leaderboards, perModeMinSizes]);

  const value = useMemo(() => ({ statsByYear }), [statsByYear]);
  return (
    <LeaderboardContext.Provider value={value}>
      {children}
    </LeaderboardContext.Provider>
  );
};

export const useLeaderboard = () => useContext(LeaderboardContext);
