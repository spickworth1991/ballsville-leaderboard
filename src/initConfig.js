// src/initConfig.js

// Named presets you can use via ?preset=<key>
export const PRESETS = {
  default:   { year: "2025", mode: "big_game",  filterType: "all",   filterValue: null },
  minigame:  { year: "2025", mode: "mini_game", filterType: "all",   filterValue: null },
  redraft:   { year: "2025", mode: "redraft",   filterType: "all",   filterValue: null },
  triathlon: { year: "2025", mode: "triathlon", filterType: "all",   filterValue: null },
  dynasty:   { year: "2025", mode: "dynasty",   filterType: "all",   filterValue: null },
};

// Read URL search params once and merge with preset defaults
export function getInitialConfig() {
  if (typeof window === "undefined") return PRESETS.default; // SSR safety

  const sp = new URLSearchParams(window.location.search);

  const presetKey = sp.get("preset") || "default";
  const base = PRESETS[presetKey] || PRESETS.default;

  // Optional filters: ?division=North OR ?league=Some%20League
  let filterType = base.filterType;
  let filterValue = base.filterValue;

  if (sp.get("division")) {
    filterType = "division";
    filterValue = sp.get("division");
  } else if (sp.get("league")) {
    filterType = "league";
    filterValue = sp.get("league");
  }

  return {
    year: sp.get("year") || base.year,
    mode: sp.get("mode") || base.mode,
    filterType,
    filterValue,
  };
}
