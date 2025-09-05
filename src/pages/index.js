// pages/index.js
'use client';
import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import Leaderboard from '../components/Leaderboard';
import useR2Live from '../hooks/useR2Live';
import useAvailableYears from '../hooks/useAvailableYears';

const BASE_PATH = '/data'; // must match your Cloudflare route to R2

// Compute live weekly + total for an owner row
function computeLiveOwner(o) {
  const weekly = { ...(o.weekly || {}) };
  const weekNums = Object.keys(weekly).map(n => Number(n)).filter(Number.isFinite);
  const latestWeek = weekNums.length ? Math.max(...weekNums) : null;

  // If latest week is 0 but we have live starters points, use them
  if (latestWeek != null) {
    const wkVal = Number(weekly[latestWeek] ?? 0);
    if (wkVal === 0 && Array.isArray(o.latestRoster?.starters) && o.latestRoster.starters.length) {
      const live = o.latestRoster.starters.reduce((sum, s) => sum + Number(s?.points || 0), 0);
      if (live > 0) weekly[latestWeek] = Number(live.toFixed(2));
    }
  }

  const weeklySum = Object.values(weekly).reduce((a, b) => a + Number(b || 0), 0);
  const displayTotal =
    weeklySum > 0
      ? weeklySum
      : Number.isFinite(Number(o.total))
      ? Number(o.total)
      : 0;

  return {
    ...o,
    weekly,
    total: Number(displayTotal.toFixed(2)), // overwrite so sorting uses live total
  };
}

export default function Home() {
  // Discover only current year + 2 back (under /data)
  const { years, error: yearsError } = useAvailableYears({
    maxYearsBack: 2,
    basePath: BASE_PATH,
  });

  // Multi-year cache: { "2025": {...}, "2024": {...} }
  const [leaderboards, setLeaderboards] = useState({});
  const [loadingYear, setLoadingYear] = useState(null);

  const [current, setCurrent] = useState({
    year: String(new Date().getFullYear()),
    mode: 'big_game',
    filterType: 'all',
    filterValue: null,
  });

  const [showWeeks, setShowWeeks] = useState(false);
  const [filteredData, setFilteredData] = useState(null);

  // Ensure current.year is one of the discovered years (default to newest)
  useEffect(() => {
    if (!years || !years.length) return;
    if (!years.includes(current.year)) {
      setCurrent(prev => ({
        ...prev,
        year: years[0],
        mode: 'big_game',
        filterType: 'all',
        filterValue: null,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years]);

  // One-shot fetch for a specific year (no polling)
  const fetchYearOnce = async (y) => {
    try {
      const base = BASE_PATH.replace(/\/$/, '');
      const res = await fetch(`${base}/leaderboards_${y}.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET leaderboards_${y}.json → ${res.status}`);
      const yearObj = await res.json();
      const shaped = yearObj && yearObj[y] ? yearObj : { [y]: yearObj[y] || yearObj };
      setLeaderboards(prev => ({ ...prev, ...shaped }));
      if (y === current.year) setLoadingYear(null);
    } catch (e) {
      console.error('prefetch failed for year', y, e);
      if (y === current.year) setLoadingYear(null);
    }
  };

  // Prefetch newest + two back as soon as we know the years
  useEffect(() => {
    if (!years || !years.length) return;
    years.slice(0, 3).forEach(y => {
      if (!leaderboards[y]) fetchYearOnce(y);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years]);

  // Live updates for the *currently selected* year (polls manifest → refetch on change)
  const { data: liveData, error: liveError } = useR2Live(current.year, {
    pollMs: 60000,
    basePath: BASE_PATH,
  });

  // When switching years: if not cached, fetch immediately
  useEffect(() => {
    if (!current.year) return;
    if (leaderboards?.[current.year]) {
      setLoadingYear(null);
    } else {
      setLoadingYear(current.year);
      fetchYearOnce(current.year);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.year, leaderboards]);

  // Merge polled data for the active year into cache
  useEffect(() => {
    if (!liveData) return;
    setLeaderboards(prev => ({ ...prev, ...liveData }));
  }, [liveData]);

  // Normalize mode + apply filters + compute live totals
  useEffect(() => {
    const yearBlock = leaderboards?.[current.year];
    if (!yearBlock) {
      setFilteredData(null);
      return;
    }

    const modes = Object.keys(yearBlock);
    if (!modes.length) {
      setFilteredData(null);
      return;
    }

    let nextMode = current.mode;
    if (!modes.includes(nextMode)) {
      nextMode =
        (modes.includes('big_game') && 'big_game') ||
        (modes.includes('redraft_2025') && 'redraft_2025') ||
        (modes.includes('redraft') && 'redraft') ||
        modes[0];

      if (nextMode !== current.mode) {
        setCurrent(prev => ({ ...prev, mode: nextMode, filterType: 'all', filterValue: null }));
      }
    }

    const fullData = yearBlock[nextMode];
    let owners = [...(fullData?.owners || [])];

    if (current.filterType === 'division') {
      owners = owners.filter(o => o.division === current.filterValue);
    } else if (current.filterType === 'league') {
      owners = owners.filter(o => o.leagueName === current.filterValue);
    }

    // Apply live totals logic per owner
    owners = owners.map(computeLiveOwner);

    setFilteredData({ ...fullData, owners });
  }, [leaderboards, current.year, current.mode, current.filterType, current.filterValue]);

  // UI states
  if (!years) return <p className="text-center mt-8">Loading years…</p>;
  if (!years.length) return <p className="text-center mt-8">No leaderboard years found.</p>;
  if (yearsError) return <p className="text-center mt-8">Error discovering years: {String(yearsError)}</p>;
  if (liveError) return <p className="text-center mt-8">Error loading {current.year}: {String(liveError)}</p>;

  const yearBlock = leaderboards?.[current.year];
  if (!yearBlock) {
    if (loadingYear === current.year) return <p className="text-center mt-8">Loading {current.year}…</p>;
    return <p className="text-center mt-8">No data for {current.year}.</p>;
  }

  const title = filteredData?.name || `${current.year}`;

  return (
    <div>
      <Navbar
        data={leaderboards}  // multi-year cache (instant switching)
        years={years}
        current={current}
        setCurrent={setCurrent}
        showWeeks={showWeeks}
        setShowWeeks={setShowWeeks}
      />
      <div className="max-w-7xl mx-auto p-6">
        <h1 className="text-4xl font-bold text-center mb-6 text-indigo-500">
          {title} {current.filterType !== 'all' ? ` - ${current.filterValue}` : ''}
        </h1>

        {filteredData && (
          <Leaderboard
            data={filteredData}
            year={current.year}
            category={current.mode}
            showWeeks={showWeeks}
            setShowWeeks={setShowWeeks}
          />
        )}
      </div>
    </div>
  );
}
