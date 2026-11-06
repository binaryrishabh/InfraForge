/* A worker counts as gone only when its end marker is present, or its process looks dead on two probes a few seconds apart
and its log has been silent. One failed process probe (a loaded laptop can return nothing) must never end a live attempt.
Pure and dependency-free so it can be unit tested without a lane. */
export function workerGone(input: { marker: boolean; aliveFirst: boolean; aliveSecond: boolean; logAgeMs: number }, silentMs = 180_000): boolean {
  if (input.marker) return true;
  if (input.aliveFirst || input.aliveSecond) return false;
  return input.logAgeMs > silentMs;
}
