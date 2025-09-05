// hooks/useAvailableYears.js
'use client';

import { useEffect, useState } from 'react';

async function urlExists(url) {
  try {
    const h = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (h.ok) return true;
  } catch {}
  try {
    const g = await fetch(url, { method: 'GET', cache: 'no-store' });
    return g.ok;
  } catch {}
  return false;
}

/**
 * Discover available leaderboard years by checking for weekly_manifest_<year>.json
 * Options:
 * - startYear: number (default: this year)
 * - maxYearsBack: number (default: 6)  → checks [startYear, startYear-1, ..., startYear-maxYearsBack]
 * - pollMs: number|null (default: null) → re-check on an interval if you want
 */
export default function useAvailableYears({
  startYear = new Date().getFullYear(),
  maxYearsBack = 6,
  pollMs = null,
} = {}) {
  const [years, setYears] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let aborted = false;
    const candidates = Array.from({ length: maxYearsBack + 1 }, (_, i) => String(startYear - i));

    async function run() {
      try {
        const results = await Promise.all(
          candidates.map(y => urlExists(`/weekly_manifest_${y}.json`))
        );
        if (aborted) return;
        const found = candidates.filter((_, i) => results[i]);
        setYears(found);      // sorted newest → oldest by construction
        setError(null);
      } catch (e) {
        if (aborted) return;
        setError(String(e));
      }
    }

    run();
    let timer;
    if (pollMs) timer = setInterval(run, pollMs);
    return () => { aborted = true; if (timer) clearInterval(timer); };
  }, [startYear, maxYearsBack, pollMs]);

  return { years, error };
}
