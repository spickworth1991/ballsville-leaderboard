'use client';

import { useEffect, useState } from 'react';

/**
 * Discovers available years by checking for /<basePath>/weekly_manifest_<year>.json
 * Defaults to basePath='/data' to match your Cloudflare → R2 route.
 */
export default function useAvailableYears({
  startYear = new Date().getFullYear(),
  maxYearsBack = 6,
  pollMs = null,
  basePath = '/data',
} = {}) {
  const [years, setYears] = useState(null);
  const [error, setError] = useState(null);

  const base = basePath.replace(/\/$/, '');

  async function urlExists(url) {
    try { const h = await fetch(url, { method: 'HEAD', cache: 'no-store' }); if (h.ok) return true; } catch {}
    try { const g = await fetch(url, { method: 'GET',  cache: 'no-store' }); return g.ok; } catch {}
    return false;
  }

  useEffect(() => {
    let aborted = false;
    const candidates = Array.from({ length: maxYearsBack + 1 }, (_, i) => String(startYear - i));

    const run = async () => {
      try {
        const results = await Promise.all(
          candidates.map(y => urlExists(`${base}/weekly_manifest_${y}.json`))
        );
        if (aborted) return;
        setYears(candidates.filter((_, i) => results[i])); // newest → oldest
        setError(null);
      } catch (e) {
        if (aborted) return;
        setError(String(e));
      }
    };

    run();
    let t; if (pollMs) t = setInterval(run, pollMs);
    return () => { aborted = true; if (t) clearInterval(t); };
  }, [startYear, maxYearsBack, pollMs, base]);

  return { years, error };
}
