export const config = { runtime: 'edge' };
export default async function handler() {
  return new Response('pong ' + new Date().toISOString(), {
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
