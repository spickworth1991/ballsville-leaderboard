// src/hooks/useR2Live.js
import { useEffect, useRef, useState } from "react";

/**
 * Polls a small manifest with HEAD to detect changes (via ETag),
 * then fetches the big leaderboard JSON only when needed.
 */
export default function useR2Live({
  manifestUrl = "/data/weekly_manifest.json",
  dataUrl = "/data/leaderboards.json",
  pollMs = 30000, // 30s
} = {}) {
  const [data, setData] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const etagRef = useRef(null);
  const ctrlRef = useRef(null);

  useEffect(() => {
    let timer;

    const check = async () => {
      try {
        setLastChecked(Date.now());

        // HEAD the tiny manifest (fast; no body)
        const head = await fetch(manifestUrl, { method: "HEAD", cache: "no-store" });
        const newTag = head.headers.get("etag") || "";

        // first load OR changed ETag => fetch big JSON
        if (!etagRef.current || newTag !== etagRef.current) {
          etagRef.current = newTag;
          ctrlRef.current?.abort();
          const res = await fetch(`${dataUrl}?t=${Date.now()}`, {
            cache: "no-store",
            signal: (ctrlRef.current = new AbortController()).signal,
          });
          const json = await res.json();
          setData(json);
        }
      } catch (e) {
        console.error("live poll error:", e);
      }
    };

    // prime & poll
    check();
    timer = setInterval(check, pollMs);

    return () => {
      clearInterval(timer);
      ctrlRef.current?.abort();
    };
  }, [manifestUrl, dataUrl, pollMs]);

  return { data, lastChecked };
}
