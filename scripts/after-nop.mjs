// scripts/after-nop.mjs
import fs from "node:fs";
import path from "node:path";

const out = path.join(".vercel", "output", "static");
const workerSrc = path.join("_worker.js");
const workerDst = path.join(out, "_worker.js");
const routes = path.join(out, "_routes.json");

// ensure output dir exists
fs.mkdirSync(out, { recursive: true });

// copy your custom worker into the final output so it runs in production
fs.copyFileSync(workerSrc, workerDst);

// remove the auto-generated _routes.json so your worker handles all routes
try { fs.unlinkSync(routes); } catch { /* ignore if it doesn't exist */ }

console.log("✔ Copied _worker.js and removed _routes.json");
