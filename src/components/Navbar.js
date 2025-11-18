// components/Navbar.jsx
'use client';
import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom'; 

export default function Navbar({ data, years: yearsProp, current, setCurrent, showWeeks, setShowWeeks }) {
  const [openSheet, setOpenSheet] = useState(null);
  const [search, setSearch] = useState('');

  if (!data) return null;

  // Prefer the explicit list from props; otherwise fall back to whatever is in data
  const years = useMemo(() => {
    const base = (yearsProp?.length ? yearsProp : Object.keys(data || {}));
    return [...base].sort((a, b) => b.localeCompare(a));
  }, [yearsProp, data]);

  // ✅ Build the available modes for the selected year (adds missing variable)
  const availableModes = useMemo(() => {
    const yearBlock = data?.[current.year] || {};
    const order = { big_game: 1, mini_game: 2, redraft_2025: 3, redraft: 3, gauntlet: 4, dynasty: 5 };
    return Object.keys(yearBlock)
      .sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99) || a.localeCompare(b));
  }, [data, current.year]);

  // Keep mode valid
  const activeMode = useMemo(() => {
    if (availableModes.includes(current.mode)) return current.mode;
    return (
      availableModes.find((k) => k === 'redraft_2025') ||
      availableModes.find((k) => k === 'redraft') ||
      availableModes[0] ||
      null
    );
  }, [availableModes, current.mode]);

  useEffect(() => {
    if (activeMode && activeMode !== current.mode) {
      setCurrent((prev) => ({ ...prev, mode: activeMode, filterType: 'all', filterValue: null }));
    }
  }, [activeMode]);

  const activeBlock = data?.[current.year]?.[activeMode];
  const isGauntlet = activeMode === 'gauntlet';
  const isRedraft2025 = activeMode === 'redraft_2025';

  const shortModeName = (val, key) => {
    const name = val?.name || key;
    const parts = String(name).split(' ').filter(Boolean);
    return parts[1] || name;
  };

  const handleSelect = (updates) => {
    setCurrent({ ...current, ...updates });
    setOpenSheet(null);
    setSearch('');
  };

  const resetFilter = () => handleSelect({ filterType: 'all', filterValue: null });

  // Lists for sheets (sorted)
  const filteredDivisions = useMemo(() => {
    const list = [...(activeBlock?.divisions || [])].sort((a, b) => a.localeCompare(b));
    if (!search.trim()) return list;
    return list.filter((d) => d.toLowerCase().includes(search.toLowerCase()));
  }, [activeBlock, search]);

  const filteredLeaguesByDivision = useMemo(() => {
    const map = activeBlock?.leaguesByDivision || {};
    const divisions = Object.keys(map).sort((a, b) => a.localeCompare(b));
    if (!search.trim()) {
      // return a sorted copy
      const result = {};
      divisions.forEach((div) => {
        result[div] = [...(map[div] || [])].sort((a, b) => a.localeCompare(b));
      });
      return result;
    }
    const result = {};
    divisions.forEach((division) => {
      const matches = (map[division] || []).filter((l) => l.toLowerCase().includes(search.toLowerCase()));
      if (matches.length) result[division] = matches.sort((a, b) => a.localeCompare(b));
    });
    return result;
  }, [activeBlock, search]);

  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-gray-950/80 border-b border-white/10">
      <div className="px-4 py-3 space-y-2">
  {/* Row 1: Left = logo + titles, Right = years + weekly + modes */}
    <div
      className="
        flex items-center gap-4
        max-[610px]:flex-wrap
        md:justify-between
        max-[610px]:flex-col max-[610px]:items-center max-[610px]:text-center
      "
    >

    {/* Left: Logo + Titles */}
    <div className="flex items-center gap-3 min-w-0">
      <img
        src="/ballsville-logo-300x300.webp"
        alt="Logo"
        className="w-12 h-12 rounded-lg object-cover ring-1 ring-white/10"
      />
      <div className="min-w-0">
      <div className="text-sm text-white/60 leading-tight">
        Ballsville
        <br className="hidden max-[450px]:block" />
        <span className="max-[450px]:hidden"> </span>
        Leaderboards
      </div>

      <div
        className="text-base font-semibold text-white leading-tight 
                  max-w-[320px] sm:max-w-[420px] md:max-w-[560px]"
        title={activeBlock?.name}
      >
        {activeBlock?.name || 'Leaderboard'}
      </div>
    </div>
    </div>

    {/* Right: Years + Weekly (top on small) and Modes (under on small) */}
    <div
      className="
        w-auto max-[610px]:w-full
        ml-auto max-[820px]:ml-0
        max-[820px]:basis-full
        flex flex-row flex-wrap
        items-center
        gap-2 md:gap-3
        justify-end max-[610px]:justify-center
      "
    >

      {/* Row A: Years + Weekly toggle */}
      <div
        className="
          flex items-center gap-2 overflow-x-auto no-scrollbar min-w-0
          justify-end
          max-[850px]:basis-full max-[850px]:justify-end
          max-[610px]:justify-center
        "
      >

        {/* Years */}
        <div className="flex items-center gap-2 flex-wrap justify-end max-[610px]:justify-center">
          {years.map((year) => (
            <Chip
              key={year}
              active={current.year === year}
              onClick={() => handleSelect({ year, filterType: 'all', filterValue: null })}
            >
              {year}
            </Chip>
          ))}
        </div>

        {/* Weekly toggle (compact) */}
        <button
          onClick={() => setShowWeeks(!showWeeks)}
          className={`shrink-0 inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs border transition ${
            showWeeks
              ? 'bg-indigo-600 text-white border-white/10'
              : 'bg-white/8 text-white/80 hover:bg-white/12 border-white/10'
          }`}
          title="Toggle weekly columns"
          aria-pressed={showWeeks}
        >
          Weekly
          <span
            className={`inline-block w-8 h-4 rounded-full p-[2px] transition ${
              showWeeks ? 'bg-white/90' : 'bg-white/25'
            }`}
          >
            <span
              className={`block w-3 h-3 bg-gray-900 rounded-full transform transition ${
                showWeeks ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </span>
        </button>
      </div>

      {/* Row B: Modes */}
      <div
        className="
          flex items-center gap-2 overflow-x-auto no-scrollbar min-w-0 md:ml-1
          justify-end
          max-[850px]:basis-full max-[850px]:justify-end
          max-[610px]:justify-center
        "
      >

        {availableModes.map((modeKey) => {
          const val = data?.[current.year]?.[modeKey];
          const label = shortModeName(val, modeKey);
          return (
            <Chip
              key={modeKey}
              active={activeMode === modeKey}
              onClick={() => handleSelect({ mode: modeKey, filterType: 'all', filterValue: null })}
            >
              {label}
            </Chip>
          );
        })}
      </div>
    </div>
  </div>

  {/* Row 2: Actions + Reset — UNCHANGED */}
  <div className="flex gap-2">
    <button
      disabled={isRedraft2025 || !activeBlock?.divisions?.length}
      onClick={() => {
        setSearch('');
        setOpenSheet('divisions');
      }}
      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition ${
        isRedraft2025 || !activeBlock?.divisions?.length
          ? 'bg-gray-800/60 text-white/40 border-white/10 cursor-not-allowed'
          : 'bg-white/5 text-white hover:bg-white/10 border-white/10'
      }`}
      title={isRedraft2025 ? 'No Divisions' : isGauntlet ? 'Browse Legions' : 'Browse Divisions'}
    >
      {isRedraft2025 ? 'No Divisions' : isGauntlet ? 'Legions' : 'Divisions'}
    </button>

    <button
      disabled={!activeBlock?.leaguesByDivision}
      onClick={() => {
        setSearch('');
        setOpenSheet('leagues');
      }}
      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition ${
        !activeBlock?.leaguesByDivision
          ? 'bg-gray-800/60 text-white/40 border-white/10 cursor-not-allowed'
          : 'bg-white/5 text-white hover:bg-white/10 border-white/10'
      }`}
      title="Browse Leagues"
    >
      Leagues
    </button>

    {current.filterType !== 'all' && (
      <button
        onClick={resetFilter}
        className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/20 text-white transition"
        title="Clear filter"
      >
        Reset
      </button>
    )}
  </div>
</div>

      {/* Fullscreen Sheet (ONLY place where search input exists) */}
      <Sheet
        open={!!openSheet}
        title={openSheet === 'divisions' ? (isGauntlet ? 'Legions' : 'Divisions') : openSheet === 'leagues' ? 'Leagues' : ''}
        onClose={() => {
          setOpenSheet(null);
          setSearch('');
        }}
        search={search}
        setSearch={setSearch}
      >
        {openSheet === 'divisions' && (
          <div className="divide-y divide-white/10">
            {filteredDivisions.length === 0 && <EmptyState msg="No matches found." />}
            {filteredDivisions.map((div) => (
              <button
                key={div}
                className="w-full text-left px-4 py-3 hover:bg-white/5 transition"
                onClick={() => handleSelect({ filterType: 'division', filterValue: div })}
              >
                <div className="text-sm text-white">{div}</div>
                <div className="text-xs text-white/50">{isGauntlet ? 'Legion' : 'Division'}</div>
              </button>
            ))}
          </div>
        )}

        {openSheet === 'leagues' && (
          <div className="space-y-6">
            {Object.keys(filteredLeaguesByDivision).length === 0 && <EmptyState msg="No leagues match your search." />}
            {Object.entries(filteredLeaguesByDivision).map(([division, leagues]) => (
              <div key={division} className="border border-white/10 rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-white/5 text-indigo-300 text-sm font-semibold">
                  {division}
                </div>
                <div className="divide-y divide-white/10">
                  {leagues.map((league) => (
                    <button
                      key={league}
                      className="w-full text-left px-4 py-3 hover:bg-white/5 transition"
                      onClick={() => handleSelect({ filterType: 'league', filterValue: league })}
                    >
                      <div className="text-sm text-white">{league}</div>
                      <div className="text-xs text-white/50">League</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </header>
  );
}

/* ---------- UI bits ---------- */

function ScrollableChips({ children, ariaLabel }) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1" aria-label={ariaLabel} role="tablist">
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition whitespace-nowrap ${
        active ? 'bg-indigo-600 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]' : 'bg-white/8 text-white/80 hover:bg-white/12'
      }`}
    >
      {children}
    </button>
  );
}

function Sheet({ open, title, onClose, children, search, setSearch }) {
  const scrollerRef = useRef(null);

  // Lock body + ESC to close (runs only when open)
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const sheetUI = (
    <>
      {/* Backdrop (click outside to close) */}
      <div
        className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Mobile: bottom sheet; Desktop: centered modal */}
      <div className="fixed inset-0 z-[9999] flex items-end md:items-center md:justify-center pointer-events-none">
        <div
          className="pointer-events-auto w-full md:max-w-3xl bg-gray-950 border border-white/10 shadow-2xl overflow-hidden rounded-t-2xl md:rounded-2xl flex flex-col"
          style={{ maxHeight: '82vh' }}
          onClick={(e) => e.stopPropagation()} // don't close when clicking inside
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
            <button
              onClick={onClose}
              className="shrink-0 w-9 h-9 grid place-items-center rounded-lg bg-white/5 text-white hover:bg-white/10 transition"
              aria-label="Close"
              title="Close"
            >
              ✕
            </button>
            <div className="text-white font-semibold">{title}</div>
          </div>

          {/* Search */}
          <div className="p-4 border-b border-white/10">
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${title.toLowerCase()}…`}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
              {!!search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-xs"
                  aria-label="Clear"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Scrollable content */}
          <div
            ref={scrollerRef}
            className="px-4 pb-6 overflow-y-auto min-h flex-1 md:max-h-[90vh]"
            style={{
              maxHeight: '90vh',  // mobile scroll area height
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {children}
          </div>
        </div>
      </div>

      {/* Adjustable paddings (mobile vs desktop) */}
      <style jsx>{`
        @media (max-width: 767px) {
          .pointer-events-none {
            padding-top: 5vh;   /* tweak mobile top padding here */
            padding-bottom: 15vh;
          }
        }
        @media (min-width: 768px) {
          .pointer-events-none {
            padding-top: 5vh;   /* tweak desktop look */
            padding-bottom: 5vh;
          }
          .pointer-events-none > div {
            max-height: 90vh !important;
          }
        }
      `}</style>
    </>
  );

  // Render above everything (fixes WP embed z-index issues)
  return createPortal(sheetUI, document.body);
}

function EmptyState({ msg }) {
  return <div className="text-center text-white/60 py-10 text-sm">{msg}</div>;
}

/* Hide scrollbars for chip rows */
const NoScrollCss = `
.no-scrollbar::-webkit-scrollbar{display:none}
.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}
`;
if (typeof document !== 'undefined' && !document.getElementById('no-scroll-style')) {
  const style = document.createElement('style');
  style.id = 'no-scroll-style';
  style.innerHTML = NoScrollCss;
  document.head.appendChild(style);
}
