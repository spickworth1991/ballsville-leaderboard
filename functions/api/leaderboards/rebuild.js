/**
 * Cloudflare Pages Function:
 *   cron-job.org  →  this function  →  GitHub workflow_dispatch  →  scripts/sched.js
 *
 * Purpose: avoid relying on GitHub's scheduled cron timing; let an external cron ping this endpoint.
 *
 * Env vars (set in Cloudflare project settings):
 *   - GITHUB_REPO                 e.g. "spickworth1991/ballsville-leaderboard"
 *   - LEADERBOARDS_WORKFLOW_FILE  e.g. "update-leaderboards.yml"
 *   - LEADERBOARDS_REF            e.g. "main" (optional, defaults to "main")
 *   - GH_WORKFLOW_TOKEN           PAT with "repo" + "workflow" scopes
 */

const GAME_TZ = "America/Detroit";

// Keep this intentionally "good enough" — it just prevents hammering during totally dead times.
function isGameWindow(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: GAME_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  const time = hour + minute / 60; // decimal hour

  // Saturday window: 16:30+
  if (weekday === "Sat" && time >= 16.5) return true;

  // Sunday window: 12:30+
  if (weekday === "Sun" && time >= 12.5) return true;

  // Monday window: 19:00+
  if (weekday === "Mon" && time >= 19) return true;

  // Thursday window: 19:00+
  if (weekday === "Thu" && time >= 19) return true;

  // Early-morning spillover (00:00–01:59) after late games
  if ((weekday === "Mon" || weekday === "Tue" || weekday === "Fri") && time < 2) {
    return true;
  }

  return false;
}

async function triggerGithubWorkflow(env, { forceRun }) {
  const repo = env.GITHUB_REPO;
  const workflowFile = env.LEADERBOARDS_WORKFLOW_FILE;
  const token = env.GH_WORKFLOW_TOKEN;
  const ref = env.LEADERBOARDS_REF || "main";

  if (!repo || !workflowFile || !token) {
    throw new Error(
      "Missing GITHUB_REPO, LEADERBOARDS_WORKFLOW_FILE, or GH_WORKFLOW_TOKEN in Cloudflare env."
    );
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`;

  const body = {
    ref,
    // Your workflow_dispatch defines an input named "force_run".
    inputs: {
      force_run: forceRun ? "true" : "false",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "ballsville-leaderboards-cf-function",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub workflow_dispatch failed: ${res.status} ${res.statusText} – ${text}`);
  }

  return { repo, workflowFile, ref, inputs: body.inputs };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";

    // ⏱ Respect game window unless forced
    if (!force && !isGameWindow()) {
      return new Response(
        JSON.stringify({
          ok: true,
          triggered: false,
          skipped: true,
          reason: "outside_game_window",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const info = await triggerGithubWorkflow(env, { forceRun: force });

    return new Response(
      JSON.stringify({ ok: true, triggered: true, skipped: false, workflow: info }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        triggered: false,
        skipped: false,
        error: err?.message || "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Optional GET sanity check
export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      ok: true,
      message:
        "POST here to trigger the Leaderboards GitHub workflow. Use ?force=1 to ignore game-time checks.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
