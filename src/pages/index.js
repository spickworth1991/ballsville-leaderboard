// pages/index.js
'use client';
import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import Leaderboard from '../components/Leaderboard';
import useR2Live from '../hooks/useR2Live';
import useAvailableYears from '../hooks/useAvailableYears';

const BASE_PATH = '/data'; // 👈 this must match your Cloudflare route to R2

export default function Home() {
  const { years, error: yearsError } = useAvailableYears({
    maxYearsBack: 8,
    basePath: BASE_PATH,            // 👈 add this
  });

  const [leaderboards, setLeaderboards] = useState(null);
  const [current, setCurrent] = useState({
    year: String(new Date().getFullYear()),
    mode: 'big_game',
    filterType: 'all',
    filterValue: null,
  });
  const [showWeeks, setShowWeeks] = useState(false);
  const [filteredData, setFilteredData] = useState(null);

  // keep current.year valid
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
  }, [years]); // eslint-disable-line react-hooks/exhaustive-deps

  // per-year live data
  const { data: liveData, error: liveError } = useR2Live(current.year, {
    pollMs: 60000,
    basePath: BASE_PATH,            // 👈 add this
  });

  useEffect(() => { if (liveData) setLeaderboards(liveData); }, [liveData]);

  // Normalize mode + apply filters
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

  // Loading / error states
  if (!years) return <p className="text-center mt-8">Loading years…</p>;
  if (!years.length) return <p className="text-center mt-8">No leaderboard years found.</p>;
  if (yearsError) return <p className="text-center mt-8">Error discovering years: {String(yearsError)}</p>;
  if (liveError) return <p className="text-center mt-8">Error loading {current.year}: {String(liveError)}</p>;
  if (!leaderboards) return <p className="text-center mt-8">Loading {current.year}…</p>;

  const yearBlock = leaderboards?.[current.year];
  if (!yearBlock) return <p className="text-center mt-8">No data for {current.year}.</p>;

  const title = filteredData?.name || `${current.year}`;

  return (
    <div>
      <Navbar
        data={leaderboards}
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
