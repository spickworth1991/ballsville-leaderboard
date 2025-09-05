'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * useR2Live (per-year)
 * - Polls weekly_manifest_<year>.json (HEAD → fallback GET)
 * - On change, fetches leaderboards_<year>.json
 * - Returns data shaped like { "<year>": { ... } }
 *
 * NOTE: basePath defaults to '/data' so URLs look like:
 *   /data/weekly_manifest_2025.json
 *   /data/leaderboards_2025.json
 * which is what your Cloudflare route likely maps to R2.
 */
export default function useR2Live(
  year,
  { pollMs = 60000, basePath = '/data' } = {}
) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const etagRef = useRef(null);
  const activeYearRef = useRef(year);

  useEffect(() => { activeYearRef.current = year; }, [year]);

  useEffect(() => {
    let timer, aborted = false;

    const yManifest = (y) => `${basePath.replace(/\/$/, '')}/weekly_manifest_${y}.json`;
    const yBoards   = (y) => `${basePath.replace(/\/$/, '')}/leaderboards_${y}.json`;

    const headOrGet = async (url) => {
      try {
        const h = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (h.ok) return h;
      } catch {}
      const g = await fetch(url, { method: 'GET', cache: 'no-store' });
      if (!g.ok) throw new Error(`FETCH ${url} → ${g.status}`);
      return g;
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
        const meta = await headOrGet(yManifest(y));
        const tag =
          meta.headers.get('etag') ||
          meta.headers.get('last-modified') ||
          meta.headers.get('content-length') ||
          etagRef.current || 'init';

        if (etagRef.current === tag && data !== null) return;

        const yearObj = await getJson(yBoards(y));
        const shaped = yearObj && yearObj[y] ? yearObj : { [y]: yearObj[y] || yearObj };

        if (aborted) return;
        etagRef.current = tag;
        setData(shaped);
        setError(null);
      } catch (e) {
        if (aborted) return;
        setError(String(e));
      }
    };

    tick();
    timer = setInterval(tick, pollMs);
    return () => { aborted = true; clearInterval(timer); };
  }, [pollMs, basePath]);

  return { data, error, etag: etagRef.current };
}
