// src/components/Leaderboard.jsx
import { useRef, useState, useEffect, useMemo } from "react";
import { useLeaderboard } from "../context/LeaderboardContext";
import { getInitialConfig } from "../initConfig";
import OwnerModal from "./OwnerModal";

export default function Leaderboard({ data, year: propYear, category, showWeeks, setShowWeeks }) {
  const initial = useMemo(() => getInitialConfig(), []);
  const [year, setYear] = useState(propYear ?? initial.year);
  const [mode, setMode] = useState(initial.mode);
  const [division, setDivision] = useState(initial.division);
  const { statsByYear } = useLeaderboard();
  const { totalTeams = 0, uniqueOwners = 0 } = statsByYear?.[year] || {};

  const sortedOwners = useMemo(
    () => [...data.owners].sort((a, b) => b.total - a.total),
    [data.owners]
  );

  // -------- Owner Search ----------
  const [query, setQuery] = useState("");
  const [focusSuggest, setFocusSuggest] = useState(false);
  const inputRef = useRef(null);

  const norm = (s) => String(s || "").toLowerCase().trim();
  const q = norm(query);

  const filteredOwners = useMemo(() => {
    if (!q) return sortedOwners;
    return sortedOwners.filter((o) => norm(o.ownerName).includes(q));
  }, [q, sortedOwners]);

  const ownerSuggestions = useMemo(() => {
    if (!q) return [];
    const names = Array.from(new Set(sortedOwners.map((o) => o.ownerName)));
    // Slightly “premium” scoring: startsWith first, then includes
    const starts = names.filter((n) => norm(n).startsWith(q));
    const includes = names.filter((n) => !norm(n).startsWith(q) && norm(n).includes(q));
    return [...starts, ...includes].slice(0, 8);
  }, [q, sortedOwners]);

  const clearQuery = () => setQuery("");

  // -------- Pagination ----------
  const [page, setPage] = useState(1);
  const itemsPerPage = 15;

  useEffect(() => {
    setPage(1); // reset to page 1 whenever filter changes
  }, [q, year, category]);

  const totalPages = Math.ceil(filteredOwners.length / itemsPerPage) || 1;
  const startIndex = (page - 1) * itemsPerPage;
  const currentOwners = filteredOwners.slice(startIndex, startIndex + itemsPerPage);

  // -------- Weekly data (unchanged) ----------
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [selectedRoster, setSelectedRoster] = useState(null);
  const [weeklyData, setWeeklyData] = useState(null);
  const [visibleWeeksStart, setVisibleWeeksStart] = useState(0);

  const weeksToShow = 3;
  const maxWeeks = data.weeks.length;

  const weeklyCache = useRef(null);

  useEffect(() => {
    const loadWeeklyData = async () => {
      if (weeklyCache.current) {
        setWeeklyData(weeklyCache.current);
        return;
      }
      let combinedData = {};
      for (let i = 1; i <= 20; i++) {
        const partUrl = `/data/weekly_rosters_part${i}.json`;
        try {
          const res = await fetch(partUrl);
          if (res.status === 404) break;
          if (!res.ok) break;
          const partData = await res.json();
          for (const y in partData) {
            if (!combinedData[y]) combinedData[y] = {};
            for (const c in partData[y]) {
              if (!combinedData[y][c]) combinedData[y][c] = {};
              Object.assign(combinedData[y][c], partData[y][c]);
            }
          }
        } catch {
          break;
        }
      }
      weeklyCache.current = combinedData;
      setWeeklyData(combinedData);
    };
    loadWeeklyData();
  }, []);

  const handleWeeklyClick = (owner, week) => {
    if (!showWeeks || !weeklyData) return;
    const leagueData = weeklyData[year]?.[category]?.[owner.leagueName]?.[week];
    if (!leagueData) return;
    const match = leagueData.find((r) => r.ownerName === owner.ownerName);
    if (match) {
      setSelectedOwner(owner);
      setSelectedRoster({ week, starters: match.starters, bench: match.bench });
    }
  };

  const currentWeeks = showWeeks ? data.weeks.slice(visibleWeeksStart, visibleWeeksStart + weeksToShow) : [];
  const uniqueLeagues = new Set(sortedOwners.map((o) => o.leagueName));
  const showLeagueColumn = uniqueLeagues.size > 1;

  const nextWeeks = () => {
    if (visibleWeeksStart + weeksToShow < maxWeeks) {
      setVisibleWeeksStart(visibleWeeksStart + weeksToShow);
    }
  };

  const prevWeeks = () => {
    if (visibleWeeksStart - weeksToShow >= 0) {
      setVisibleWeeksStart(visibleWeeksStart - weeksToShow);
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
        <span className="bg-yellow-400/30">{n.slice(i, i + q.length)}</span>
        {n.slice(i + q.length)}
      </>
    );
  };

  return (
    <div className="overflow-x-auto animate-fadeIn pt-2">
      {/* Premium Owner Search */}
      <div className="max-w-3xl mx-auto w-full mb-4 px-2">
        <div className="relative">
          <div className="flex items-center gap-2 bg-gray-900/70 border border-white/10 rounded-xl px-3 py-2">
            {/* magnifier */}
            <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-70">
              <path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.471 6.471 0 0 0 1.57-4.23A6.5 6.5 0 1 0 9.5 16a6.471 6.471 0 0 0 4.23-1.57l.27.28v.79L20 21.5L21.5 20zM4 9.5C4 6.46 6.46 4 9.5 4S15 6.46 15 9.5S12.54 15 9.5 15S4 12.54 4 9.5" />
            </svg>

            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocusSuggest(true)}
              onBlur={() => setTimeout(() => setFocusSuggest(false), 120)} // slight delay so clicks register
              placeholder="Search owners…"
              className="flex-1 bg-transparent outline-none text-sm text-white placeholder-white/40"
            />

            {query && (
              <button
                onClick={clearQuery}
                className="text-white/70 hover:text-white text-xs px-2 py-1 rounded-md bg-white/10"
              >
                Clear
              </button>
            )}
          </div>

          {/* Suggestions dropdown */}
          {focusSuggest && ownerSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 mt-2 bg-gray-950 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-20">
              <div className="max-h-72 overflow-y-auto divide-y divide-white/10">
                {ownerSuggestions.map((name) => (
                  <button
                    key={name}
                    className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/5"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQuery(name);   // filter directly to this owner
                      setFocusSuggest(false);
                    }}
                  >
                    {highlight(name)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Stats + result count line */}
           <div className="mt-1 text-xs text-white/50">
            Total teams drafted {year}: <span className="text-white">{totalTeams}</span> •
            {' '}Unique owners in {year}: <span className="text-white">{uniqueOwners}</span>
          </div> 

        </div>
      </div>

      {/* Weeks pager (unchanged) */}
      {showWeeks && (
        <div className="flex justify-center items-center gap-3 mb-4">
          <button
            onClick={prevWeeks}
            disabled={visibleWeeksStart === 0}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            ◀ Prev
          </button>
          <span className="text-white">
            Showing weeks {visibleWeeksStart + 1}-{Math.min(visibleWeeksStart + weeksToShow, maxWeeks)}
          </span>
          <button
            onClick={nextWeeks}
            disabled={visibleWeeksStart + weeksToShow >= maxWeeks}
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
                <th key={w} className="p-2 text-center whitespace-nowrap">W{w}</th>
              ))}
            <th className="p-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {currentOwners.map((o, idx) => (
            <tr
              key={`${o.ownerName}-${idx}`}
              className="border-b border-gray-700 hover:bg-gray-900"
              onClick={() => !showWeeks && setSelectedOwner(o)}
            >
              <td className="p-2">{startIndex + idx + 1}</td>
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
                    {o.weekly[w]?.toFixed(2) || "-"}
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
            Prev
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page === totalPages}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Modal */}
      {selectedOwner && (
        <OwnerModal
          owner={selectedOwner}
          selectedRoster={selectedRoster}
          onClose={() => {
            setSelectedOwner(null);
            setSelectedRoster(null);
          }}
          allOwners={data.owners}
        />
      )}
    </div>
  );
}
