// src/components/Leaderboard.jsx
import { useRef, useState, useEffect, useMemo } from "react";
import { useLeaderboard } from "../context/LeaderboardContext";
import OwnerModal from "./OwnerModal";

const WEEKS_WINDOW = 3; // how many weeks to show at once

export default function Leaderboard({ data, year, category, showWeeks, setShowWeeks }) {
  const { statsByYear } = useLeaderboard();
  const { totalTeams = 0, uniqueOwners = 0 } = statsByYear?.[year] || {};

  // Build a globally-ranked list 
  const rankedOwners = useMemo(() => {
    const list = [...data.owners].sort((a, b) =>
      (b.total - a.total) ||
      a.ownerName.localeCompare(b.ownerName) ||
      (a.leagueName || "").localeCompare(b.leagueName || "")
    );
    return list.map((o, i) => ({ ...o, globalRank: i + 1 }));
  }, [data.owners]);

  // -------- Owner Search ----------
  const [query, setQuery] = useState("");
  const [focusSuggest, setFocusSuggest] = useState(false);
  const inputRef = useRef(null);

  const norm = (s) => String(s || "").toLowerCase().trim();
  const q = norm(query);

  // -------- Weekly sort/filter ----------
  const [weeklySortWeek, setWeeklySortWeek] = useState(null); // number | null
  const [weeklySortDir, setWeeklySortDir] = useState("desc"); // "asc" | "desc"
  const [weeklyHighsOnly, setWeeklyHighsOnly] = useState(false);

  // Suggestions / filtered list
  const filteredOwners = useMemo(() => {
    let base = !q ? rankedOwners : rankedOwners.filter((o) => norm(o.ownerName).includes(q));

    // When in weeks view and a sort week is selected, sort by that week's score
    if (showWeeks && weeklySortWeek != null) {
      const w = weeklySortWeek;
      base = [...base].sort((a, b) => {
        const av = typeof a.weekly?.[w] === "number" ? a.weekly[w] : -Infinity;
        const bv = typeof b.weekly?.[w] === "number" ? b.weekly[w] : -Infinity;
        if (av === bv) return (a.globalRank || 0) - (b.globalRank || 0);
        return weeklySortDir === "asc" ? av - bv : bv - av;
      });
      if (weeklyHighsOnly) {
        const max = base.reduce((m, o) => {
          const v = typeof o.weekly?.[w] === "number" ? o.weekly[w] : -Infinity;
          return Math.max(m, v);
        }, -Infinity);
        base = base.filter(o => (typeof o.weekly?.[w] === "number" ? o.weekly[w] : -Infinity) === max);
      }
    }
    return base;
  }, [q, rankedOwners, showWeeks, weeklySortWeek, weeklySortDir, weeklyHighsOnly]);

  const ownerSuggestions = useMemo(() => {
    if (!q) return [];
    const names = Array.from(new Set(rankedOwners.map((o) => o.ownerName)));
    const starts = names.filter((n) => norm(n).startsWith(q));
    const includes = names.filter((n) => !norm(n).startsWith(q) && norm(n).includes(q));
    return [...starts, ...includes].slice(0, 8);
  }, [q, rankedOwners]);

  const clearQuery = () => setQuery("");

  // -------- Pagination ----------
  const [page, setPage] = useState(1);
  const itemsPerPage = 15;

  useEffect(() => {
    setPage(1); // reset to page 1 whenever filter changes
  }, [q, year, category]);

  // -------- Weekly data (per-year) ----------
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [selectedRoster, setSelectedRoster] = useState(null);
  const [weeklyData, setWeeklyData] = useState(null);
  const [visibleWeeksStart, setVisibleWeeksStart] = useState(0);
  const weeklyCache = useRef({}); // cache per year

  // Reset weeks pager & weekly sort when year/mode/toggle changes
  useEffect(() => {
    setVisibleWeeksStart(0);
  }, [year, category, showWeeks]);
  useEffect(() => { setWeeklySortWeek(null); setWeeklyHighsOnly(false); }, [year, category, showWeeks]);
  // helper used in multiple places
const sumPoints = (arr = []) =>
  arr.reduce(
    (s, p) =>
      s +
      Number(
        p?.points ??
        p?.pts ??
        p?.score ??
        p?.value ??
        0
      ),
    0
  );

// When Weekly is turned on and weeklyData is ready, jump pager to latest non-zero week
useEffect(() => {
  if (!showWeeks || !weeklyData) return;

  const weeks = Array.isArray(data.weeks) ? [...data.weeks] : [];
  if (!weeks.length) return;

  // Descending: newest → oldest
  weeks.sort((a, b) => b - a);

  // Does ANY owner have non-zero points this week?
  const ownerHasPoints = (wk) => {
    for (const o of rankedOwners) {
      // 1) Use precomputed weekly totals on the owner if available
      const val = typeof o.weekly?.[wk] === "number" ? o.weekly[wk] : null;
      if (val != null && val > 0) return true;

      // 2) Fallback to roster records in weeklyData
      const leagueWeeks = weeklyData[year]?.[category]?.[o.leagueName] || {};
      const recArr = leagueWeeks[wk] || [];
      const rec = recArr.find((r) => r.ownerName === o.ownerName);
      if (rec) {
        const total = sumPoints(rec.starters) + sumPoints(rec.bench);
        if (total > 0) return true;
      }
    }
    return false;
  };

  let targetWeek = null;
  for (const wk of weeks) {
    if (ownerHasPoints(wk)) {
      targetWeek = wk;
      break;
    }
  }
  if (targetWeek == null) return;

  // Position pager so targetWeek is visible in the WEEKS_WINDOW
  const start = Math.floor((targetWeek - 1) / WEEKS_WINDOW) * WEEKS_WINDOW;
  setVisibleWeeksStart(start);
}, [showWeeks, weeklyData, year, category, rankedOwners, data.weeks]);


  // Helper: load weekly data (used both by Weekly view and by row click when Weekly is off)
  const loadWeeklyDataForYear = async () => {
    if (weeklyCache.current[year]) {
      setWeeklyData(weeklyCache.current[year]);
      return weeklyCache.current[year];
    }
    try {
      const manRes = await fetch(`/data/weekly_manifest_${year}.json`, { cache: "no-store" });
      if (!manRes.ok) {
        return null;
      }
      const manifest = await manRes.json(); // { parts: ["weekly_rosters_YYYY_part1.json", ...] }
      let combined = {};
      for (const part of (manifest.parts || [])) {
        const url = `/data/${part}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const chunk = await res.json();
        // Merge { [year]: { [mode]: { [leagueName]: { [week]: [ {ownerName, starters, bench}, ... ] } } } }
        for (const y in chunk) {
          combined[y] = combined[y] || {};
          for (const mode in chunk[y]) {
            combined[y][mode] = combined[y][mode] || {};
            Object.assign(combined[y][mode], chunk[y][mode]);
          }
        }
      }
      weeklyCache.current[year] = combined;
      setWeeklyData(combined);
      return combined;
    } catch {
      return null;
    }
  };

  // Only auto-load when Weekly is ON; otherwise we lazy-load on click
  useEffect(() => {
    let ignore = false;
    const go = async () => {
      if (!showWeeks) {
        // If we already have cache for this year, reflect it; otherwise skip loading now.
        if (weeklyCache.current[year] && !ignore) setWeeklyData(weeklyCache.current[year]);
        return;
      }
      const data = await loadWeeklyDataForYear();
      if (!ignore && data) setWeeklyData(data);
    };
    go();
    return () => { ignore = true; };
  }, [showWeeks, year, category]);

  const handleWeeklyClick = (owner, week) => {
    if (!weeklyData) return;
    const leagueData = weeklyData[year]?.[category]?.[owner.leagueName]?.[week];
    if (!leagueData) return;
    const match = leagueData.find((r) => r.ownerName === owner.ownerName);
    if (match) {
      setSelectedOwner(owner);
      setSelectedRoster({ week, starters: match.starters, bench: match.bench });
    }
  };

  // NEW: open modal for latest week when Weekly is OFF
  // Prefer the latest week that has actual points (non-zero)
// Falls back to checking roster arrays if owner.weekly[wk] isn't present.
const handleRowClickLatest = async (owner) => {
  // Ensure weekly data is available (lazy load if needed)
  let wd = weeklyData;
  if (!wd) {
    wd = await loadWeeklyDataForYear();
    if (!wd) return;
  }

  const leagueWeeks = wd[year]?.[category]?.[owner.leagueName] || {};
  const weekNumbers = Object.keys(leagueWeeks)
    .map((k) => Number(k))
    .filter(Number.isFinite)
    .sort((a, b) => b - a); // latest → earliest

  const getOwnerRec = (wk) => {
    const arr = leagueWeeks[wk] || [];
    return arr.find((r) => r.ownerName === owner.ownerName);
  };

  const sumPoints = (arr = []) =>
    arr.reduce(
      (s, p) =>
        s +
        Number(
          p?.points ??
          p?.pts ??
          p?.score ??
          p?.value ??
          0
        ),
      0
    );

  const isNonZeroWeek = (wk) => {
    // 1) Use precomputed weekly totals on the owner if available
    const val = typeof owner.weekly?.[wk] === "number" ? owner.weekly[wk] : null;
    if (val != null && val > 0) return true;

    // 2) Otherwise, inspect the roster record
    const rec = getOwnerRec(wk);
    if (!rec) return false;
    const total = sumPoints(rec.starters) + sumPoints(rec.bench);
    return total > 0;
  };

  // Pick the latest non-zero week
  let chosen = null;
  for (const wk of weekNumbers) {
    if (isNonZeroWeek(wk)) {
      const rec = getOwnerRec(wk);
      if (!rec) continue;
      chosen = { week: wk, starters: rec.starters, bench: rec.bench };
      break;
    }
  }

  if (!chosen) return; // nothing meaningful to show

  setSelectedOwner(owner);
  setSelectedRoster(chosen);
};

  const maxWeeks = Array.isArray(data.weeks) ? data.weeks.length : 0;
  const currentWeeks =
    showWeeks && maxWeeks
      ? data.weeks.slice(visibleWeeksStart, Math.min(visibleWeeksStart + WEEKS_WINDOW, maxWeeks))
      : [];

  const uniqueLeagues = new Set(rankedOwners.map((o) => o.leagueName));
  const showLeagueColumn = uniqueLeagues.size > 1;

  const nextWeeks = () => {
    if (visibleWeeksStart + WEEKS_WINDOW < maxWeeks) {
      setVisibleWeeksStart(visibleWeeksStart + WEEKS_WINDOW);
    }
  };

  const prevWeeks = () => {
    if (visibleWeeksStart - WEEKS_WINDOW >= 0) {
      setVisibleWeeksStart(visibleWeeksStart - WEEKS_WINDOW);
    }
  };

  // Simple highlight util for suggestions
  const highlight = (name) => {
    const n = String(name);
    if (!q) return n;
    const i = n.toLowerCase().indexOf(q);
    if (i === -1) return n;
    return (
      <>
        {n.slice(0, i)}
        <span className="text-blue-400">{n.slice(i, i + q.length)}</span>
        {n.slice(i + q.length)}
      </>
    );
  };

  const totalPages = Math.ceil(filteredOwners.length / itemsPerPage) || 1;
  const startIndex = (page - 1) * itemsPerPage;
  const currentOwners = filteredOwners.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4 px-2 sm:px-0">
        {/* Left: Owners & Teams */}
        <p className="text-sm text-white/60 whitespace-nowrap">
          {uniqueOwners} owners across {totalTeams} teams
        </p>

        {/* Middle: Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocusSuggest(true)}
            onBlur={() => setTimeout(() => setFocusSuggest(false), 100)}
            placeholder="Search owner…"
            className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 outline-none"
          />
          {!!q && (
            <button
              onMouseDown={(e) => e.preventDefault() }
              onClick={clearQuery}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
            >
              ✕
            </button>
          )}

          {/* Suggestions */}
          {focusSuggest && ownerSuggestions.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg max-h-64 overflow-auto">
              {ownerSuggestions.map((name) => (
                <button
                  key={name}
                  className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/5"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQuery(name);
                    setFocusSuggest(false);
                  }}
                >
                  {highlight(name)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Stats line */}
        <div className="text-xs text-white/50 whitespace-nowrap">
          Showing {currentOwners.length} of {filteredOwners.length}
        </div>
      </div>


      {/* Week sort/filter controls */}
      {showWeeks && currentWeeks.length > 0 && (
        <div className="flex items-center justify-between mb-2 text-sm">
          <button
            onClick={prevWeeks}
            disabled={visibleWeeksStart === 0}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            ◀ Prev
          </button>
          <span className="text-white">
            Showing weeks {visibleWeeksStart + 1}-{Math.min(visibleWeeksStart + WEEKS_WINDOW, maxWeeks)}
            <div className="flex items-center gap-3 mb-2 text-sm">
          <button
            type="button"
            className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50"
            onClick={() => { setWeeklySortWeek(null); setWeeklyHighsOnly(false); }}
            disabled={weeklySortWeek == null && !weeklyHighsOnly}
            title="Clear week sort/filter"
          >
            Clear week sort
          </button>
          
        </div>
          </span>
          <button
            onClick={nextWeeks}
            disabled={visibleWeeksStart + WEEKS_WINDOW >= maxWeeks}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            Next ▶
          </button>
        </div>
      )}

      {/* Table */}
      <table className="w-full text-left border border-gray-700 rounded-lg text-xs sm:text-sm md:text-base">
        <thead>
          <tr className="bg-gray-800 sticky top-0">
            <th className="p-2">Rank</th>
            <th className="p-2">Owner</th>
            <th>Draft Slot</th>
            {showLeagueColumn && <th className="p-2">League</th>}
            {showWeeks &&
              currentWeeks.map((w) => (
                <th key={w} className="p-2 text-center whitespace-nowrap">
                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
                    onClick={() => {
                      if (weeklySortWeek === w) {
                        setWeeklySortDir(d => (d === "desc" ? "asc" : "desc"));
                      } else {
                        setWeeklySortWeek(w);
                        setWeeklySortDir("desc");
                      }
                    }}
                    title="Sort by this week's points"
                  >
                    W{w}{weeklySortWeek === w ? (weeklySortDir === "desc" ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
            <th className="p-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {currentOwners.map((o, idx) => (
            <tr
              key={`${o.ownerName}-${idx}`}
              className="border-b border-gray-700 hover:bg-gray-900"
              onClick={() => {
                if (showWeeks) return; // weekly cells have their own click handler
                // open modal with latest week's roster for this owner
                handleRowClickLatest(o);
              }}
            >
              <td className="p-2">{o.globalRank}</td>
              <td className="p-2">{o.ownerName}</td>
              <td>{o.draftSlot ? `(${o.draftSlot})` : "-"}</td>
              {showLeagueColumn && <td className="p-2">{o.leagueName}</td>}
              {showWeeks &&
                currentWeeks.map((w) => (
                  <td
                    key={w}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleWeeklyClick(o, w);
                    }}
                    className="p-2 text-center text-blue-400 cursor-pointer hover:bg-blue-700 hover:text-white rounded transition"
                  >
                    {typeof o.weekly?.[w] === "number" ? o.weekly[w].toFixed(2) : "-"}
                  </td>
                ))}
              <td className="p-2 font-bold">{o.total}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-4 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            ◀ Prev
          </button>
          <div className="px-3 py-2">Page {page} of {totalPages}</div>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page === totalPages}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            Next ▶
          </button>
        </div>
      )}

      {/* Owner modal (weekly details) */}
      {selectedOwner && selectedRoster && (
        <OwnerModal
          owner={selectedOwner}
          selectedRoster={selectedRoster}
          onClose={() => {
            setSelectedOwner(null);
            setSelectedRoster(null);
          }}
          allOwners={data.owners}
          year={year}
          mode={category}
          basePath="/data"
        />
      )}
    </div>
  );
}
