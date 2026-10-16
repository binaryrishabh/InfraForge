import type { RuntimeUsageObserver, UsageEmitter, UsageSource } from "./contracts";

export function usageSource(source: UsageSource, clock: { now: number }, observer?: RuntimeUsageObserver): UsageEmitter | undefined {
  if (!observer?.select(source.family, source.resource)) return;
  let sequence = 0;
  const key = JSON.stringify([source.family, source.resource, source.profile]);
  const receive = observer.attach({ ...source }, () => sequence);
  return (detail) => receive({ source: key, sequence: ++sequence, atUs: clock.now, detail });
}
