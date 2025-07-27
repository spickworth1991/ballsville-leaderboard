"use client";
import { useEffect, useState } from "react";

export default function OwnerModal({ owner, onClose, allOwners, selectedRoster }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => setVisible(true), []);
  if (!owner) return null;

  const otherLeagues = allOwners
    .filter(o => o.ownerName === owner.ownerName && o.leagueName !== owner.leagueName)
    .map(o => ({ name: o.leagueName, total: o.total }))
    .sort((a, b) => b.total - a.total);

  const roster = selectedRoster || owner.latestRoster;

  const startersTotal = roster ? roster.starters.reduce((sum, p) => sum + (p.points || 0), 0).toFixed(2) : 0;
  const benchTotal = roster ? roster.bench.reduce((sum, p) => sum + (p.points || 0), 0).toFixed(2) : 0;

  return (
    <div
      className={`fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 transition-opacity duration-500 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="bg-gray-900 p-2 sm:p-6 rounded-lg shadow-lg w-[95%] sm:max-w-2xl max-h-[95vh] overflow-auto relative">
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
          Draft Slot: <span className="text-yellow-400 font-bold">#{owner.draftSlot || "-"} </span> |{" "}
          {selectedRoster ? (
            <>
              Week {roster.week} Points:{" "}
              <span className="text-blue-400 font-semibold">{startersTotal}</span>{" "}
              <span className="text-gray-400">(Total: {owner.total})</span>
            </>
          ) : (
            <>
              Total Points: <span className="text-blue-400 font-semibold">{owner.total}</span>
            </>
          )}
        </p>

        {/* ✅ Roster Section */}
        {roster && (
          <div className="mb-3 sm:mb-6">
            <h3 className="text-sm sm:text-lg font-semibold mb-1 sm:mb-2 text-center text-green-400">
              {selectedRoster ? `Week ${roster.week} Roster` : `Latest Roster (Week ${roster.week})`}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
              {/* Starters */}
              <div>
                <h4 className="font-semibold text-blue-400 mb-1 text-xs sm:text-base">Starters</h4>
                <ul className="border border-gray-700 rounded p-1 sm:p-2 space-y-0.5 sm:space-y-1 text-xs sm:text-sm max-h-28 sm:max-h-64 overflow-y-auto">
                  {roster.starters.map((p, i) => (
                    <li key={i} className="flex justify-between">
                      <span className="truncate">{p.name}</span>
                      <span className="text-gray-400">{p.points} pts</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-1 sm:mt-2 text-right text-yellow-400 font-bold text-xs sm:text-sm">
                  Total: {startersTotal} pts
                </div>
              </div>

              {/* Bench */}
              <div>
                <h4 className="font-semibold text-gray-300 mb-1 text-xs sm:text-base">Bench</h4>
                <div className="border border-gray-700 rounded p-1 sm:p-2 overflow-y-auto max-h-20 sm:max-h-64">
                  <ul className="text-xs sm:text-sm space-y-0.5 sm:space-y-1">
                    {roster.bench.map((p, i) => (
                      <li key={i} className="flex justify-between">
                        <span className="truncate">{p.name}</span>
                        <span className="text-gray-400">{p.points} pts</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-1 sm:mt-2 text-right text-yellow-400 font-bold text-xs sm:text-sm">
                  Total: {benchTotal} pts
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
}
