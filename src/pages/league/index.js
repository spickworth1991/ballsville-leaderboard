import Link from "next/link";
import { useEffect, useState } from "react";

export default function LeaguesHome() {
  const [data, setData] = useState(null);

  useEffect(() => {
  fetch("/data/leaderboard.json", { cache: 'no-store' })
    .then(res => res.json())
    .then(json => setData(json));
  }, []);

  if (!data) return <div className="text-white text-center mt-10">Loading...</div>;

  const leagues = [...new Set(data.owners.map(o => o.leagueName))];

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <h1 className="text-4xl font-bold text-center mb-8">Select a League</h1>

      <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto">
        {leagues.map((lg, idx) => (
          <Link key={idx} href={`/league/${encodeURIComponent(lg)}`}>
            <button className="bg-gray-800 hover:bg-gray-700 px-6 py-4 rounded-lg w-full text-xl transition">
              {lg}
            </button>
          </Link>
        ))}
      </div>

      <div className="text-center mt-8">
        <Link href="/">
          <button className="bg-blue-600 hover:bg-blue-800 px-6 py-3 rounded-lg transition">Back to Home</button>
        </Link>
      </div>
    </div>
  );
}
