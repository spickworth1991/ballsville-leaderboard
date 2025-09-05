'use client';
import { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import Leaderboard from '../components/Leaderboard';
import useR2Live from '../hooks/useR2Live';
import { getInitialConfig } from '../initConfig';

export default function Home() {
  const initial = useMemo(() => getInitialConfig(), []);
  const [leaderboards, setLeaderboards] = useState(null);

  // Seed from URL/preset instead of hardcoding big_game
  const [current, setCurrent] = useState({
    year: initial.year,           // e.g., "2025" or URL override
    mode: initial.mode,           // e.g., "mini_game" from ?preset=minigame
    filterType: initial.filterType,   // "all" | "division" | "league"
    filterValue: initial.filterValue, // value or null
  });

  const [showWeeks, setShowWeeks] = useState(false);
  const [filteredData, setFilteredData] = useState(null);

  // Live data (polls weekly_manifest.json; fetches leaderboards.json on ETag change)
  const { data: liveData } = useR2Live();

  // Whenever live data changes, update the source of truth
  useEffect(() => {
    if (liveData) setLeaderboards(liveData);
  }, [liveData]);

  // Normalize mode + apply filters whenever inputs change
  useEffect(() => {
    if (!leaderboards) return;

    const yearBlock = leaderboards?.[current.year];
    if (!yearBlock) return;

    const modes = Object.keys(yearBlock);
    if (!modes.length) return;

    let nextMode = current.mode;

    // If preset/URL mode doesn't exist in this year's data, fall back sanely
    if (!modes.includes(nextMode)) {
      nextMode =
        (modes.includes('big_game') && 'big_game') ||
        (modes.includes('redraft_2025') && 'redraft_2025') ||
        (modes.includes('redraft') && 'redraft') ||
        modes[0];

      if (nextMode !== current.mode) {
        setCurrent(prev => ({ ...prev, mode: nextMode, filterType: 'all', filterValue: null }));
        return; // let next render recalc with corrected mode
      }
    }

    const fullData = yearBlock[nextMode];
    let filteredOwners = [...(fullData?.owners || [])];

    if (current.filterType === 'division') {
      filteredOwners = filteredOwners.filter(o => o.division === current.filterValue);
    } else if (current.filterType === 'league') {
      filteredOwners = filteredOwners.filter(o => o.leagueName === current.filterValue);
    }

    setFilteredData({ ...fullData, owners: filteredOwners });
  }, [leaderboards, current.year, current.mode, current.filterType, current.filterValue]);

  if (!leaderboards) return <p className="text-center mt-8">Loading...</p>;

  const title = filteredData?.name || `${current.year}`;

  return (
    <div>
      <Navbar
        data={leaderboards}
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
