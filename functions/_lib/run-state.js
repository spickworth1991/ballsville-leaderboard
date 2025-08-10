// simple in-memory registry of live runs (per isolate)
const runs = new Map();

export function createRun() {
  const id = crypto.randomUUID();
  const state = { canceled: false };
  runs.set(id, state);
  return { id, state };
}

export function getRun(id) {
  return runs.get(id) || null;
}

export function cancelRun(id) {
  const s = runs.get(id);
  if (s) s.canceled = true;
  return !!s;
}

export function endRun(id) {
  runs.delete(id);
}
