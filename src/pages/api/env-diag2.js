export const config = { runtime: 'edge' };

export default async function handler(req, ctx) {
  try {
    // Do not import anything; be paranoid about optional chaining.
    const hasCtx = !!ctx;
    const hasEnv = !!ctx?.env;

    // Only touch env keys if env exists
    const flags = hasEnv ? {
      ADMIN_USER: !!ctx.env.ADMIN_USER,
      ADMIN_PASS: !!ctx.env.ADMIN_PASS,
      ADMIN_SESSION_SECRET: !!ctx.env.ADMIN_SESSION_SECRET,
      ADMIN_TOKEN: !!ctx.env.ADMIN_TOKEN,
      CONFIG_KV: !!ctx.env.CONFIG_KV,
      LEADERBOARDS: !!ctx.env.LEADERBOARDS,
    } : null;

    const out = { ok: true, hasCtx, hasEnv, flags };
    return new Response(JSON.stringify(out, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    // Never throw — always surface as text so the browser shows something useful.
    return new Response('diag error: ' + String(e), {
      status: 200,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    });
  }
}
