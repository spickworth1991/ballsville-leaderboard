'use client';
import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import Leaderboard from '../components/Leaderboard';
import useR2Live from '../hooks/useR2Live';
import useAvailableYears from '../hooks/useAvailableYears';

const BASE_PATH = '/data'; // <- matches your Cloudflare route to R2

export default function Home() {
  const { years, error: yearsError } = useAvailableYears({
    maxYearsBack: 8,
    basePath: BASE_PATH,          // 👈 ensure discovery checks /data/...
  });

  // Cache of all loaded years, shape: { "2025": {...}, "2024": {...} }
  const [leaderboards, setLeaderboards] = useState({});
  const [loadedYear, setLoadedYear] = useState(null);    // last year we merged in
  const [loadingYear, setLoadingYear] = useState(null);  // year currently waiting on

  const [current, setCurrent] = useState({
    year: String(new Date().getFullYear()),
    mode: 'big_game',
    filterType: 'all',
    filterValue: null,
  });

  const [showWeeks, setShowWeeks] = useState(false);
  const [filteredData, setFilteredData] = useState(null);

  // When year list arrives, ensure current.year is valid (pick newest if not)
  useEffect(() => {
    if (!years || !years.length) return;
    if (!years.includes(current.year)) {
      setCurrent(prev => ({
        ...prev,
        year: years[0], // newest available
        mode: 'big_game',
        filterType: 'all',
        filterValue: null,
      }));
    }
  }, [years]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kick off per-year live fetches (polls manifest and pulls that year’s leaderboards)
  const { data: liveData, error: liveError } = useR2Live(current.year, {
    pollMs: 60000,
    basePath: BASE_PATH,          // 👈 ensure fetches /data/weekly_manifest_<y>.json, /data/leaderboards_<y>.json
  });

  // When switching years, if not cached, mark as loading; if cached, clear loading
  useEffect(() => {
    if (!current.year) return;
    if (leaderboards?.[current.year]) {
      setLoadingYear(null); // we already have it, render instantly
    } else {
      setLoadingYear(current.year); // show "Loading <year>…" until liveData arrives
    }
  }, [current.year, leaderboards]);

  // Merge newly fetched year into cache; clear loading if it’s the current year
  useEffect(() => {
    if (!liveData) return;
    const y = Object.keys(liveData)[0]; // the year the hook just fetched
    setLeaderboards(prev => ({ ...prev, ...liveData }));
    setLoadedYear(y);
    if (y === current.year) setLoadingYear(null);
  }, [liveData, current.year]);

  // Normalize mode + apply filters whenever inputs change
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

    if (current.filterType === 'division') owners = owners.filter(o => o.division === current.filterValue);
    else if (current.filterType === 'league') owners = owners.filter(o => o.leagueName === current.filterValue);

    setFilteredData({ ...fullData, owners });
  }, [leaderboards, current.year, current.mode, current.filterType, current.filterValue]);

  // Loading / error states (friendlier and no “No data” flicker)
  if (!years) return <p className="text-center mt-8">Loading years…</p>;
  if (!years.length) return <p className="text-center mt-8">No leaderboard years found.</p>;
  if (yearsError) return <p className="text-center mt-8">Error discovering years: {String(yearsError)}</p>;
  if (liveError) return <p className="text-center mt-8">Error loading {current.year}: {String(liveError)}</p>;

  const yearBlock = leaderboards?.[current.year];

  if (!yearBlock) {
    // If the manifest said this year exists but we haven't fetched it yet, show a loading message
    if (loadingYear === current.year) {
      return <p className="text-center mt-8">Loading {current.year}…</p>;
    }
    // Otherwise truly no data
    return <p className="text-center mt-8">No data for {current.year}.</p>;
  }

  const title = filteredData?.name || `${current.year}`;

  return (
    <div>
      <Navbar
        data={leaderboards}      // 👈 now a multi-year cache
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
