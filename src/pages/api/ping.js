export const config = { runtime: 'edge' };

export default async function handler() {
  // If this 500s, your whole Edge bundle is failing before route code runs.
  return new Response('pong ' + new Date().toISOString(), {
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
