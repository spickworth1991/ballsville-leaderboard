// scripts/sched.js
// Wrapper to run auto-gen.js in "auto" mode for the current season,
// but ONLY during NFL game windows (Detroit time). It also writes a flag
// file when it actually runs, so GitHub Actions can decide whether to upload.

function getCurrentSeason(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1; // 1-12
  return m <= 2 ? y - 1 : y;
}

const CURRENT_SEASON = getCurrentSeason();

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const FORCE_RUN = String(process.env.FORCE_RUN || "").toLowerCase() === "true";
const FLAG_PATH = path.join(__dirname, "..", ".leaderboard_update_done");

const GAME_TZ = "America/Detroit";

function getDetroitParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: GAME_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value; // "Sun", "Mon", ...
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  const time = hour + minute / 60; // decimal hour
  return { weekday, hour, minute, time };
}

function inGameWindow(now = new Date()) {
  const { weekday, time } = getDetroitParts(now);

  // Match the same philosophy you used on the CF function:
  // - Sat: 16:30+
  // - Sun: 12:30+
  // - Mon: 19:00+
  // - Thu: 19:00+
  // - Spillover: 00:00–01:59 on Mon/Tue/Fri
  if (weekday === "Sat" && time >= 16.5) return true;
  if (weekday === "Sun" && time >= 12.5) return true;
  if (weekday === "Mon" && time >= 19) return true;
  if (weekday === "Thu" && time >= 19) return true;

  // Early-morning spillover (00:00–01:59)
  if ((weekday === "Mon" || weekday === "Tue" || weekday === "Fri") && time < 2) {
    return true;
  }

  return false;
}

// Always clear any stale flag at the start of a run
try {
  if (fs.existsSync(FLAG_PATH)) fs.unlinkSync(FLAG_PATH);
} catch (_) {
  // ignore
}

if (!FORCE_RUN && !inGameWindow()) {
  const p = getDetroitParts(new Date());
  console.log(
    `⏱ Outside NFL game window (Detroit time). Now: ${p.weekday} ${String(Math.floor(p.time)).padStart(2, "0")}:${String(Math.round((p.time % 1) * 60)).padStart(2, "0")} – skipping auto generation.`
  );
  process.exit(0);
}

if (FORCE_RUN) {
  console.log("⚡ FORCE_RUN enabled – ignoring NFL game window.");
}

const year = String(CURRENT_SEASON);
console.log(`🏈 Running auto-gen for CURRENT_SEASON=${year}...`);

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
  }

  console.log("✅ Auto generation complete.");
});
