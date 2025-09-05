"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export default function OwnerModal({
  owner,
  onClose,
  allOwners = [],
  selectedRoster = null,
  year,                 // 👈 pass current.year
  mode,                 // 👈 pass current.mode (e.g., 'big_game')
  basePath = "/data",   // 👈 where your R2 files are exposed
}) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hydratedRoster, setHydratedRoster] = useState(null);
  const [hydrating, setHydrating] = useState(false);

  useEffect(() => { setMounted(true); setVisible(true); }, []);
  if (!owner || !mounted) return null;

  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Weekly map → find latest non-zero week
  const weeklyMap = owner.weekly || {};
  const weeksDesc = useMemo(
    () =>
      Object.keys(weeklyMap)
        .map((w) => Number(w))
        .filter((w) => Number.isFinite(w))
        .sort((a, b) => b - a),
    [weeklyMap]
  );
  const mostRecentNonZeroWeek =
    weeksDesc.find((w) => toNum(weeklyMap[w]) > 0) ?? weeksDesc[0] ?? null;

  // Latest roster has any non-zero points?
  const latestHasPoints = Array.isArray(owner.latestRoster?.starters)
    ? owner.latestRoster.starters.some((s) => toNum(s?.points) > 0)
    : false;

  // Pick roster + week labels (pre-hydration)
  const baseRoster = selectedRoster || (latestHasPoints ? owner.latestRoster : owner.latestRoster || null);
  const chosenWeek =
    selectedRoster?.week ??
    (latestHasPoints ? owner.latestRoster?.week : mostRecentNonZeroWeek ?? owner.latestRoster?.week ?? null);

  // Helper: is a roster "all zeros" (both starters and bench)?
  const isZeroRoster = (r) => {
    if (!r) return true;
    const hasStarter = Array.isArray(r.starters) && r.starters.length;
    const hasBench = Array.isArray(r.bench) && r.bench.length;
    const startersZero = (r.starters || []).every((p) => toNum(p.points) === 0);
    const benchZero = (r.bench || []).every((p) => toNum(p.points) === 0);
    return (hasStarter || hasBench) && startersZero && benchZero;
  };

  // 👇 Try to hydrate from weekly parts if:
  // - we have year+mode+week, and
  // - the baseRoster is zeroed (common when latestRoster points are missing), and
  // - we haven't already hydrated.
  useEffect(() => {
    let cancelled = false;
    async function hydrateIfNeeded() {
      if (!year || !mode || !owner?.leagueName || chosenWeek == null) return;
      if (!isZeroRoster(baseRoster) || hydratedRoster || hydrating) return;

      try {
        setHydrating(true);

        // Load manifest
        const mRes = await fetch(
          `${basePath.replace(/\/$/, "")}/weekly_manifest_${year}.json?t=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!mRes.ok) throw new Error(`manifest ${year} → ${mRes.status}`);
        const manifest = await mRes.json();
        const parts = Array.isArray(manifest?.parts) ? manifest.parts : [];

        // Scan parts until we find the league + week
        for (const fname of parts) {
          const pRes = await fetch(`${basePath.replace(/\/$/, "")}/${fname}?t=${Date.now()}`, { cache: "no-store" });
          if (!pRes.ok) continue;
          const j = await pRes.json();
          const yBlock = j?.[year];
          const modeBlock = yBlock?.[mode];
          const leagueBlock = modeBlock?.[owner.leagueName];
          const weekKey = String(chosenWeek);
          const rosterArr = leagueBlock?.[weekKey]; // array of { ownerName, starters[], bench[] }

          if (Array.isArray(rosterArr)) {
            const entry = rosterArr.find((r) => r.ownerName === owner.ownerName);
            if (entry) {
              if (!cancelled) setHydratedRoster(entry);
              break;
            }
          }
        }
      } catch (_) {
        // swallow; we'll just show what we have
      } finally {
        if (!cancelled) setHydrating(false);
      }
    }
    hydrateIfNeeded();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, mode, owner?.leagueName, owner?.ownerName, chosenWeek, basePath, baseRoster, hydratedRoster]);

  const chosenRoster = hydratedRoster || baseRoster;

  // Totals
  const startersTotalNum = chosenRoster
    ? (chosenRoster.starters || []).reduce((sum, p) => sum + toNum(p.points), 0)
    : 0;
  const benchTotalNum = chosenRoster
    ? (chosenRoster.bench || []).reduce((sum, p) => sum + toNum(p.points), 0)
    : 0;

  // Display week points: prefer finalized weekly map if present & > 0; else live starters sum
  const weeklyValForChosen = chosenWeek != null ? toNum(weeklyMap[chosenWeek]) : 0;
  const displayWeekPoints = weeklyValForChosen > 0 ? weeklyValForChosen : startersTotalNum;

  // Other leagues (same name)
  const otherLeagues = (allOwners || [])
    .filter((o) => o.ownerName === owner.ownerName && o.leagueName !== owner.leagueName)
    .map((o) => ({ name: o.leagueName, total: toNum(o.total) }))
    .sort((a, b) => b.total - a.total);

  const modalContent = (
    <div
      className={`fixed top-0 left-0 w-screen h-screen bg-black bg-opacity-70 flex items-center justify-center z-[9999] transition-opacity duration-500 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="bg-gray-900 rounded-lg shadow-lg w-[95%] sm:max-w-2xl max-h-[90vh] overflow-y-auto relative p-2 sm:p-6 m-2">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-1 sm:top-2 right-2 text-white text-lg sm:text-xl hover:text-red-500"
        >
          ✖
        </button>

        {/* Header */}
        <h2 className="text-base sm:text-2xl font-bold mb-1 sm:mb-2 text-center truncate">{owner.ownerName}</h2>
        <p className="text-gray-400 mb-1 sm:mb-2 text-center text-xs sm:text-base">
          League: <span className="text-indigo-400">{owner.leagueName}</span>
        </p>
        <p className="text-center mb-2 sm:mb-4 text-xs sm:text-sm">
          Draft Slot: <span className="text-yellow-400 font-bold">#{owner.draftSlot || "-"}</span>
          {"  "}|{" "}
          {chosenWeek != null ? (
            <>
              Week {chosenWeek} Points:{" "}
              <span className="text-blue-400 font-semibold">{displayWeekPoints.toFixed(2)}</span>{" "}
              <span className="text-gray-400">(Season Total: {toNum(owner.total).toFixed(2)})</span>
            </>
          ) : (
            <>
              Season Total: <span className="text-blue-400 font-semibold">{toNum(owner.total).toFixed(2)}</span>
            </>
          )}
        </p>

        {/* Info banner if hydrating */}
        {hydrating && isZeroRoster(baseRoster) && (
          <p className="text-center text-[11px] text-white/60 mb-2">
            Loading lineup details for Week {chosenWeek}…
          </p>
        )}

        {/* Roster */}
        {chosenRoster && (
          <div className="mb-3 sm:mb-6">
            <h3 className="text-sm sm:text-lg font-semibold mb-1 sm:mb-2 text-center text-green-400">
              {selectedRoster
                ? `Week ${chosenWeek} Roster`
                : `Latest Roster${chosenWeek != null ? ` (Week ${chosenWeek})` : ""}`}
            </h3>

            {/* If list and totals week differ (rare) */}
            {!selectedRoster &&
              chosenWeek != null &&
              owner.latestRoster?.week != null &&
              !latestHasPoints &&
              owner.latestRoster.week !== chosenWeek && (
                <p className="text-center text-xs sm:text-sm text-white/60 mb-2">
                  Showing most recent non-zero week ({chosenWeek}) for totals; lineup list may reflect Week{" "}
                  {owner.latestRoster.week}.
                </p>
              )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
              {/* Starters */}
              <div>
                <h4 className="font-semibold text-blue-400 mb-1 text-xs sm:text-base">Starters</h4>
                <ul className="border border-gray-700 rounded p-1 sm:p-2 space-y-0.5 sm:space-y-1 text-xs sm:text-sm max-h-28 sm:max-h-64 overflow-y-auto">
                  {(chosenRoster.starters || []).map((p, i) => (
                    <li key={i} className="flex justify-between">
                      <span className="truncate">{p.name}</span>
                      <span className="text-gray-400">{toNum(p.points).toFixed(2)} pts</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-1 sm:mt-2 text-right text-yellow-400 font-bold text-xs sm:text-sm">
                  Total: {startersTotalNum.toFixed(2)} pts
                </div>
              </div>

              {/* Bench */}
              <div>
                <h4 className="font-semibold text-gray-300 mb-1 text-xs sm:text-base">Bench</h4>
                <div className="border border-gray-700 rounded p-1 sm:p-2 overflow-y-auto max-h-20 sm:max-h-64">
                  <ul className="text-xs sm:text-sm space-y-0.5 sm:space-y-1">
                    {(chosenRoster.bench || []).map((p, i) => (
                      <li key={i} className="flex justify-between">
                        <span className="truncate">{p.name}</span>
                        <span className="text-gray-400">{toNum(p.points).toFixed(2)} pts</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-1 sm:mt-2 text-right text-yellow-400 font-bold text-xs sm:text-sm">
                  Total: {benchTotalNum.toFixed(2)} pts
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Other Leagues */}
        {otherLeagues.length > 0 && (
          <div>
            <h3 className="text-sm sm:text-lg font-semibold mb-1 sm:mb-2 text-center">Other Leagues</h3>
            <div className="max-h-20 sm:max-h-32 overflow-y-auto border border-gray-700 rounded p-1 sm:p-2">
              <ul className="list-disc list-inside text-gray-300 space-y-0.5 sm:space-y-1 text-xs sm:text-base">
                {otherLeagues.map((lg, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="truncate">{lg.name}</span>
                    <span className="text-blue-400">{lg.total.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
