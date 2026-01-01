// /hooks/season.js
// Single source of truth for the site's "current season".
// Rule of thumb: the NFL season year is the year the season STARTS (Sep).
// Jan/Feb are still the prior season (playoffs / Super Bowl), so we roll back.

export function getCurrentSeason(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1; // 1-12

  // Jan + Feb are still considered the previous season year.
  // March and later count as the new season year.
  return m <= 2 ? y - 1 : y;
}

// Convenience constant for client components.
export const CURRENT_SEASON = getCurrentSeason();
