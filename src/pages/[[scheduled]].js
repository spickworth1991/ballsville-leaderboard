import { generateAll } from "./_lib/generate";

export default {
  async scheduled(_controller, env) {
    const scheduleJSON = (await env.CONFIG_KV.get("schedule")) || '{"hourUTC":7,"minuteUTC":0,"enabled":true}';
    const { hourUTC, minuteUTC, enabled } = JSON.parse(scheduleJSON);
    if (!enabled) return;

    const now = new Date();
    const lastRunTs = Number((await env.CONFIG_KV.get("last_run_ts")) || 0);
    const last = lastRunTs ? new Date(lastRunTs) : null;
    const alreadyToday = last &&
      last.getUTCFullYear() === now.getUTCFullYear() &&
      last.getUTCMonth() === now.getUTCMonth() &&
      last.getUTCDate() === now.getUTCDate();

    const within10 = now.getUTCHours() === hourUTC && Math.abs(now.getUTCMinutes() - minuteUTC) <= 10;

    if (!alreadyToday && within10) {
      await generateAll(env);
      await env.CONFIG_KV.put("last_run_ts", Date.now().toString());
    }
  }
};
