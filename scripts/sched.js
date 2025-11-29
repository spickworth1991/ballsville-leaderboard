// scripts/sched.js
// Wrapper to run auto-gen.js in "auto" mode for the current year,
// but ONLY during NFL game windows (Detroit time). It also writes a flag
// file when it actually runs, so GitHub Actions can decide whether to upload.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const FORCE_RUN = process.env.FORCE_RUN === "true";


const FLAG_PATH = path.join(__dirname, "..", ".leaderboard_update_done");

function inGameWindow() {
  const now = new Date();

  // Convert to America/Detroit local time (handles DST)
  const detroitString = now.toLocaleString("en-US", {
    timeZone: "America/Detroit",
    hour12: false,
  });
  const detroit = new Date(detroitString);

  const day = detroit.getDay();    // 0 = Sun, 1 = Mon, ..., 4 = Thu
  const hour = detroit.getHours(); // 0–23

  // Sunday window: 12:00–23:59
  if (day === 0 && hour >= 12 && hour < 24) return true;

  // Monday night: 19:00–23:59
  if (day === 1 && hour >= 19 && hour < 24) return true;

  // Thursday night: 19:00–23:59
  if (day === 4 && hour >= 19 && hour < 24) return true;

  return false;
}

// Always clear any stale flag at the start of a run
try {
  if (fs.existsSync(FLAG_PATH)) {
    fs.unlinkSync(FLAG_PATH);
  }
} catch (_) {
  // ignore
}

if (!FORCE_RUN && !inGameWindow()) {
  console.log(
    "⏱ Outside NFL game window (Detroit time) – skipping auto generation."
  );
  process.exit(0);
}

if (FORCE_RUN) {
  console.log("⚡ FORCE_RUN enabled – ignoring NFL game window.");
}


const year = new Date().getFullYear().toString();
console.log(
  `🏈 In NFL game window – auto-generating leaderboards for year ${year}...`
);

const child = spawn("node", ["scripts/auto-gen.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    LEADERBOARD_YEARS: year,
    USE_CACHED_PLAYERS: "true",
  },
});

child.on("close", (code) => {
  if (code !== 0) {
    console.error(`❌ auto-gen.js exited with code ${code}`);
    process.exit(code);
  }

  // Mark that we actually generated fresh files this run
  try {
    fs.writeFileSync(FLAG_PATH, `updated ${year}\n`, "utf8");
  } catch (err) {
    console.error("⚠️ Could not write flag file:", err);
    // still succeed, files are generated
  }

  console.log("✅ Auto generation complete.");
});
