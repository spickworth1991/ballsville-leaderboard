// Define presets for common embeds
export const PRESETS = {
  default: { year: 2025, mode: "big_game", division: null },
  blog:    { year: 2025, mode: "mini_game", division: null },
  shop:    { year: 2024, mode: "triathlon", division: "North" },
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
