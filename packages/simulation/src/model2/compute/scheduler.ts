import { lexical, type EventClock } from "../time";
import { fairShares } from "./sharing";

interface Job { id: string; cap: number; remaining: number; competitor: boolean; done(): void }
export function cpuScheduler(id: string, initialCapacity: number, kernel: EventClock, quota?: { budget: number; period: number }) {
  const jobs = new Map<string, Job>(); let rates = new Map<string, number>();
  let capacity = initialCapacity, paused = false, anchor = kernel.now, available = 0, app = 0, competitor = 0, throttled = 0, pressure = 0;
  let budget = quota?.budget ?? Infinity, period = quota ? Math.floor(kernel.now / quota.period) : 0;
  let cancelBoundary: (() => boolean) | undefined, updating = false, boundaries = 0;
  const projection = () => {
    const dt = kernel.now - anchor, totalRate = [...rates.values()].reduce((a, b) => a + b, 0);
    const serviceDt = totalRate > 0 ? Math.min(dt, budget / totalRate) : 0;
    let usedApp = 0, usedCompetitor = 0;
    const remaining = new Map<string, number>();
    for (const j of jobs.values()) {
      const consumed = Math.min(j.remaining, (rates.get(j.id) ?? 0) * serviceDt);
      remaining.set(j.id, Math.max(0, j.remaining - consumed));
      if (j.competitor) usedCompetitor += consumed; else usedApp += consumed;
    }
    const wanted = [...jobs.values()].reduce((sum, j) => sum + j.cap, 0);
    const granted = [...rates.values()].reduce((a, b) => a + b, 0);
    return { remaining, usedApp, usedCompetitor, available: capacity * dt,
      throttled: !paused && jobs.size && quota ? (budget <= 0 ? dt : usedApp + usedCompetitor >= budget && totalRate > 0 ? dt - serviceDt : 0) : 0,
      pressure: paused ? 0 : Math.max(0, wanted * dt - granted * serviceDt) };
  };
  const settle = () => {
    const p = projection(); available += p.available; app += p.usedApp; competitor += p.usedCompetitor; throttled += p.throttled; pressure += p.pressure;
    for (const [key, remaining] of p.remaining) jobs.get(key)!.remaining = remaining;
    budget = Math.max(0, budget - p.usedApp - p.usedCompetitor); anchor = kernel.now;
    if (quota && Math.floor(kernel.now / quota.period) > period) { period = Math.floor(kernel.now / quota.period); budget = quota.budget; }
  };
  const reschedule = () => {
    if (updating) return;
    cancelBoundary?.(); cancelBoundary = undefined;
    rates = fairShares([...jobs.values()], paused || budget <= 0 ? 0 : capacity);
    if (!jobs.size) return;
    let delay = !paused && [...jobs.values()].some((j) => j.remaining <= 0) ? 0 : Infinity;
    for (const j of jobs.values()) { const rate = rates.get(j.id) ?? 0; if (rate > 0) delay = Math.min(delay, Math.max(1, Math.ceil(j.remaining / rate))); }
    const totalRate = [...rates.values()].reduce((a, b) => a + b, 0);
    if (quota) {
      if (totalRate > 0) delay = Math.min(delay, Math.max(1, Math.ceil(budget / totalRate)));
      // Replenishment is a meaningful boundary, not a scheduling quantum.
      if (!paused) delay = Math.min(delay, (period + 1) * quota.period - kernel.now);
    }
    if (!Number.isFinite(delay)) return;
    cancelBoundary = kernel.schedule(kernel.now + delay, 2, JSON.stringify(["cpu-boundary", id]), () => {
      boundaries++; settle(); updating = true;
      const finished = [...jobs.values()].filter((j) => j.remaining <= 0).sort((a, b) => lexical(a.id, b.id));
      for (const j of finished) jobs.delete(j.id);
      for (const j of finished) j.done();
      updating = false; reschedule();
    });
  };
  return {
    add(job: { id: string; demand: number; cap: number; competitor?: boolean; done(): void }) {
      settle(); if (jobs.has(job.id)) throw new Error("Duplicate runnable invocation");
      if (job.demand <= 0) { job.done(); reschedule(); return; }
      jobs.set(job.id, { id: job.id, cap: job.cap, remaining: job.demand, competitor: job.competitor ?? false, done: job.done }); reschedule();
    },
    remove(key: string) { settle(); jobs.delete(key); reschedule(); },
    pause(value: boolean) { settle(); paused = value; reschedule(); },
    capacity(value: number) { settle(); capacity = value; reschedule(); },
    measure() {
      const p = projection(), remainingBudget = quota && Math.floor(kernel.now / quota.period) > period ? quota.budget : Math.max(0, budget - p.usedApp - p.usedCompetitor);
      return { capacity, runnable: jobs.size, receivingShare: [...rates.values()].filter((r) => r > 0).length,
        contended: !paused && [...jobs.values()].some((j) => (rates.get(j.id) ?? 0) < j.cap), paused,
        throttled: !paused && jobs.size > 0 && remainingBudget <= 0,
        appCoreUs: app + p.usedApp, competitorCoreUs: competitor + p.usedCompetitor, availableCoreUs: available + p.available,
        throttledWallUs: throttled + p.throttled, unsatisfiedParallelismUs: pressure + p.pressure,
        quotaRemainingCoreUs: quota ? remainingBudget : null,
        allocations: [...jobs.values()].sort((a, b) => lexical(a.id, b.id)).map((j) => ({ id: j.id, cores: rates.get(j.id) ?? 0, remainingCoreUs: p.remaining.get(j.id)! })), boundaries };
    },
  };
}
