// hooks/useR2Live.js
'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * useR2Live (per-year only)
 * - HEAD polls /weekly_manifest_<year>.json for ETag
 * - On change, fetches /leaderboards_<year>.json
 * - Returns data shaped like { "<year>": { ... } } for drop-in compatibility
 */
export default function useR2Live(year, { pollMs = 60000 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [etag, setEtag] = useState(null);
  const activeYearRef = useRef(year);

  useEffect(() => {
    activeYearRef.current = year;
  }, [year]);

  useEffect(() => {
    let timer;
    let aborted = false;

    const yManifest = (y) => `/weekly_manifest_${y}.json`;
    const yBoards   = (y) => `/leaderboards_${y}.json`;

    const head = async (url) => {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!res.ok) throw new Error(`HEAD ${url} → ${res.status}`);
      return res;
    };

    const getJson = async (url) => {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
      return res.json();
    };

    const tick = async () => {
      if (aborted) return;

      const y = activeYearRef.current;
      try {
        const headRes = await head(yManifest(y));
        const e = headRes.headers.get('etag') || headRes.headers.get('x-amz-meta-etag') || Date.now().toString();

        if (etag === e && data !== null) return;

        const yearObj = await getJson(yBoards(y));
        const shaped  = yearObj && yearObj[y] ? yearObj : { [y]: yearObj[y] || yearObj };

        if (aborted) return;
        setEtag(e);
        setData(shaped);
        setError(null);
      } catch (err) {
        if (aborted) return;
        setError(String(err));
      }
    };

    tick();
    timer = setInterval(tick, pollMs);
    return () => {
      aborted = true;
      clearInterval(timer);
    };
  }, [pollMs]);

  return { data, error, etag };
}
