export interface ReadinessSnapshot { success: boolean }
interface CacheOptions {
  intervalMs?: number; maxAgeMs?: number; now?: () => number;
  schedule?: (run: () => void, delay: number) => () => void;
}
// Requests only read snapshots. Only startup and this background scheduler probe.
export function createReadinessCache<T extends ReadinessSnapshot>(probe: () => Promise<T>, options: CacheOptions = {}) {
  // maxAge covers one interval plus a slow deep probe (several 2 s query timeouts),
  // so a slow but healthy check never flaps readiness to 503.
  const interval = options.intervalMs ?? 10000, maxAge = options.maxAgeMs ?? 30000;
  if (!Number.isSafeInteger(interval) || interval < 1 || !Number.isSafeInteger(maxAge) || maxAge < interval) throw Error("Invalid readiness cache timing");
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((run, delay) => {
    const timer = setTimeout(run, delay); timer.unref(); return () => clearTimeout(timer);
  });
  let snapshot: T | ReadinessSnapshot = { success: false }, completedAt: number | undefined;
  let pending: Promise<void> | undefined, cancel: (() => void) | undefined, closed = false;
  const refresh = (): Promise<void> => {
    if (closed) return Promise.resolve();
    return pending ??= (async () => {
      try { snapshot = await probe(); } catch { snapshot = { success: false }; }
      completedAt = now();
    })().finally(() => {
      pending = undefined;
      if (!closed) cancel = schedule(() => { void refresh(); }, interval);
    });
  };
  const started = refresh();
  return {
    started,
    check: (): T | ReadinessSnapshot => !closed && completedAt !== undefined && now() - completedAt < maxAge ? snapshot : { success: false },
    close: async () => { closed = true; cancel?.(); await pending; },
  };
}
