"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function OwnerModal({ owner, onClose, allOwners = [], selectedRoster = null }) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); setVisible(true); }, []);
  if (!owner || !mounted) return null;

  // --- Helpers
  const toNum = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;

  // Find most-recent non-zero week from owner's weekly map
  const weeklyMap = owner.weekly || {};
  const weeksDesc = Object.keys(weeklyMap)
    .map((w) => Number(w))
    .filter((w) => Number.isFinite(w))
    .sort((a, b) => b - a);

  const mostRecentNonZeroWeek = weeksDesc.find((w) => toNum(weeklyMap[w]) > 0) ?? weeksDesc[0] ?? null;

  // Do we have a "live" latestRoster with non-zero starter points?
  const latestHasPoints = Array.isArray(owner.latestRoster?.starters)
    ? owner.latestRoster.starters.some((s) => toNum(s?.points) > 0)
    : false;

  // Choose the best roster & week to show
  // Priority:
  // 1) selectedRoster (when you clicked a weekly cell)
  // 2) latestRoster if it has points
  // 3) fallback: show latestRoster list but use the mostRecentNonZeroWeek value for week label + totals
  const chosenRoster = selectedRoster || (latestHasPoints ? owner.latestRoster : owner.latestRoster || null);
  const chosenWeek =
    selectedRoster?.week ??
    (latestHasPoints ? owner.latestRoster?.week : mostRecentNonZeroWeek ?? owner.latestRoster?.week ?? null);

  // Totals
  const startersTotalNum = chosenRoster
    ? chosenRoster.starters.reduce((sum, p) => sum + toNum(p.points), 0)
    : 0;
  const benchTotalNum = chosenRoster
    ? chosenRoster.bench.reduce((sum, p) => sum + toNum(p.points), 0)
    : 0;

  // Display total logic: prefer weekly map for the chosen week if it exists and > 0 (finalized),
  // otherwise fall back to live starters sum
  const weeklyValForChosen = chosenWeek != null ? toNum(weeklyMap[chosenWeek]) : 0;
  const displayWeekPoints = weeklyValForChosen > 0 ? weeklyValForChosen : startersTotalNum;

  // Other leagues (same owner name)
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
        {/* Close Button */}
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

        {/* Roster */}
        {chosenRoster && (
          <div className="mb-3 sm:mb-6">
            <h3 className="text-sm sm:text-lg font-semibold mb-1 sm:mb-2 text-center text-green-400">
              {selectedRoster
                ? `Week ${chosenWeek} Roster`
                : `Latest Roster${chosenWeek != null ? ` (Week ${chosenWeek})` : ""}`}
            </h3>

            {/* If the list we have is from a different week than the one whose total we’re showing, indicate it */}
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
                  {chosenRoster.starters.map((p, i) => (
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
                    {chosenRoster.bench.map((p, i) => (
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
