'use client';
import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import Leaderboard from '../components/Leaderboard';
import useR2Live from '../hooks/useR2Live';

export default function Home() {
  const [leaderboards, setLeaderboards] = useState(null);
  const [current, setCurrent] = useState({
    year: '2025',
    mode: 'big_game',
    filterType: 'all',
    filterValue: null,
  });
  const [showWeeks, setShowWeeks] = useState(false);
  const [filteredData, setFilteredData] = useState(null);

  // ✅ Live data from R2 (polls weekly_manifest.json with HEAD; fetches leaderboards.json only when ETag changes)
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
    if (!modes.includes(nextMode)) {
      nextMode =
        (modes.includes('big_game') && 'big_game') ||
        (modes.includes('redraft_2025') && 'redraft_2025') ||
        (modes.includes('redraft') && 'redraft') ||
        modes[0];

      // reset filters if mode changes
      if (nextMode !== current.mode) {
        setCurrent(prev => ({ ...prev, mode: nextMode, filterType: 'all', filterValue: null }));
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
