// src/initConfig.js

// Define presets for each game type
export const PRESETS = {
  default:    { year: 2025, mode: "big_game",   division: null },
  minigame:   { year: 2025, mode: "mini_game",  division: null },
  redraft:    { year: 2025, mode: "redraft",    division: null },
  triathlon:  { year: 2025, mode: "triathlon",  division: null },
  dynasty:    { year: 2025, mode: "dynasty",    division: null },
};

export function getInitialConfig() {
  if (typeof window === "undefined") return PRESETS.default; // SSR safety

  const sp = new URLSearchParams(window.location.search);
  const presetKey = sp.get("preset") || "default";
  const base = PRESETS[presetKey] || PRESETS.default;

  return {
    year:     Number(sp.get("year") ?? base.year ?? 2025),
    mode:     String(sp.get("mode") ?? base.mode ?? "big_game"),
    division: sp.get("division") ?? base.division ?? null,
  };
}
