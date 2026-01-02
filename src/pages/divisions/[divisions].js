import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Leaderboard from "../../components/Leaderboard";
import { CURRENT_SEASON } from "../../hooks/season";

export default function DivisionPage() {
  const router = useRouter();
  const { divisions } = router.query; // ✅ Match filename [divisions].js
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!router.isReady) return;

    fetch(`/data/leaderboards_${CURRENT_SEASON}.json`, { cache: "no-store" })
    .then(res => res.json())
    .then(json => {
        const divisionName = decodeURIComponent(divisions || "");
        const filteredOwners = json.owners.filter(
          o => o.division?.toLowerCase() === divisionName.toLowerCase()
        );
        setData({ weeks: json.weeks, owners: filteredOwners });
      });
  }, [router.isReady, divisions]);

  if (!data) return <div className="text-center text-white mt-10">Loading...</div>;

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <h1 className="text-3xl font-bold mb-6 text-center">{decodeURIComponent(divisions || "")} Division</h1>
      {data.owners.length > 0 ? (
        <Leaderboard data={data} />
      ) : (
        <p className="text-center text-gray-400">No owners found for this division.</p>
      )}

      <div className="text-center mt-8">
        <Link href="/divisions">
          <button className="bg-blue-600 hover:bg-blue-800 px-6 py-3 rounded-lg transition">Back to Divisions</button>
        </Link>
      </div>
    </div>
  );
}
