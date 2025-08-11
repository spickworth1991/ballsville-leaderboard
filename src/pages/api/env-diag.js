// Super-minimal environment probe (no imports).
export const config = { runtime: 'edge' };

export default async function handler(req, ctx) {
  const env = ctx?.env || {};
  // Only show presence — not values
  const flags = {
    ADMIN_USER: !!env.ADMIN_USER,
    ADMIN_PASS: !!env.ADMIN_PASS,
    ADMIN_SESSION_SECRET: !!env.ADMIN_SESSION_SECRET,
    ADMIN_TOKEN: !!env.ADMIN_TOKEN,
    // Also useful to see your bindings are attached:
    CONFIG_KV: !!env.CONFIG_KV,
    LEADERBOARDS: !!env.LEADERBOARDS,
  };

  return new Response(JSON.stringify(flags, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
