import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Leaderboard from "../../components/Leaderboard";

export default function LeaguePage() {
  const router = useRouter();
  const { league } = router.query;
  const [data, setData] = useState(null);

  useEffect(() => {
  fetch("/data/leaderboard.json", { cache: 'no-store' })
    .then(res => res.json())
    .then(json => setData(json));
  }, [league]);

  if (!data) return <div className="text-center text-white mt-10">Loading...</div>;

  const filteredOwners = data.owners.filter(o => o.leagueName === league);
  const leagueData = { ...data, owners: filteredOwners };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <h1 className="text-3xl font-bold mb-6 text-center">{league} League</h1>
      <Leaderboard data={leagueData} />

      <div className="text-center mt-8">
        <Link href="/league">
          <button className="bg-blue-600 hover:bg-blue-800 px-6 py-3 rounded-lg transition">Back to Leagues</button>
        </Link>
      </div>
    </div>
  );
}
