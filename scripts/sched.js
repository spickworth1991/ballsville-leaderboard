// scripts/auto-gen.js
// Wrapper to run generate-leaderboards.mjs in "auto" mode for the current year,
// but ONLY during NFL game windows (Detroit time).

const { spawn } = require("child_process");

function inGameWindow() {
  const now = new Date();

  // Convert to America/Detroit local time (handles DST correctly)
  const detroitString = now.toLocaleString("en-US", {
    timeZone: "America/Detroit",
    hour12: false,
  });
  const detroit = new Date(detroitString);

  const day = detroit.getDay();   // 0 = Sun, 1 = Mon, ..., 4 = Thu
  const hour = detroit.getHours(); // 0–23

  // Sunday window: 12:00–23:59
  if (day === 0 && hour >= 12 && hour < 24) return true;

  // Monday night window: 19:00–23:59
  if (day === 1 && hour >= 19 && hour < 24) return true;

  // Thursday night window: 19:00–23:59
  if (day === 4 && hour >= 19 && hour < 24) return true;

  return false;
}

if (!inGameWindow()) {
  console.log("⏱ Outside NFL game window (Detroit time) – skipping auto generation.");
  process.exit(0); // exit SUCCESS so GitHub shows green
}

const year = new Date().getFullYear().toString();
console.log(`🏈 In NFL game window – auto-generating leaderboards for year ${year}...`);

const child = spawn("node", ["scripts/generate-leaderboards.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    LEADERBOARD_YEARS: year,
    USE_CACHED_PLAYERS: "true",
  },
});

child.on("close", (code) => {
  if (code !== 0) {
    console.error(`❌ generate-leaderboards.mjs exited with code ${code}`);
    process.exit(code);
  }
  console.log("✅ Auto generation complete.");
});
