import { requireKnown } from "../../reality/quantity";
import type { Deliver } from "../compute/run";
import type { EventKernel } from "../time";
import type { Invocation, Receipt, RemoteCompletion } from "../workload/contracts";
import type { SchedulerConfig } from "./contracts";

interface Trigger { ordinal: number; at: number; attempts: number; cancel?: () => boolean; receipt?: Receipt }
export function scheduler(config: SchedulerConfig, clock: EventKernel, send: Deliver, horizon: number) {
  const period = requireKnown(config.period, "us"), limit = requireKnown(config.maxTriggers, "count");
  const concurrency = config.overlap === "allow" ? requireKnown(config.maxConcurrent, "count") : 1;
  const queueLimit = requireKnown(config.queueCapacity, "count"), attempts = requireKnown(config.maxAttempts, "count");
  const timeout = requireKnown(config.timeout, "us"), retry = requireKnown(config.retryDelay, "us"), lateness = requireKnown(config.maxLateness, "us");
  const active = new Map<number, Trigger>(), queue: Trigger[] = [];
  let paused = false, started = false, latest: Trigger | undefined;
  let due = 0, fired = 0, skippedOverlap = 0, missed = 0, retried = 0, failed = 0, completed = 0, peakActive = 0, peakQueued = 0, rejectedInbound = 0, omitted = 0;
  const events: Array<{ atUs: number; trigger: number; attempt: number; outcome: string }> = [];
  const record = (t: Trigger, outcome: string) => { if (events.length < 2048) events.push({ atUs: clock.now, trigger: t.ordinal, attempt: t.attempts, outcome }); else omitted++; };
  const stale = (t: Trigger) => clock.now - t.at > lateness;
  const drain = () => {
    while (!paused && active.size < concurrency && queue.length) {
      const t = queue.shift()!;
      if (stale(t)) { missed++; record(t, "missed-late"); } else launch(t);
    }
  };
  const dispatch = (t: Trigger) => {
    if (paused || stale(t)) { active.delete(t.ordinal); missed++; failed++; record(t, "missed-before-attempt"); drain(); return; }
    t.attempts++; fired++; if (t.attempts > 1) retried++;
    let settled = false;
    const settle = (ok: boolean, reason: string) => {
      if (settled) return; settled = true; t.cancel?.(); t.cancel = undefined;
      record(t, reason);
      if (ok) { active.delete(t.ordinal); completed++; drain(); }
      else if (t.attempts >= attempts) { active.delete(t.ordinal); failed++; missed++; drain(); }
      else t.cancel = clock.schedule(clock.now + retry, 2, JSON.stringify(["scheduler-retry", config.id, t.ordinal, t.attempts]), () => dispatch(t));
    };
    t.cancel = clock.schedule(clock.now + timeout, 1, JSON.stringify(["scheduler-timeout", config.id, t.ordinal, t.attempts]), () => {
      const receipt = t.receipt; settle(false, "timeout-ambiguous"); receipt?.cancel();
    });
    const rootId = JSON.stringify(["scheduler", config.id, t.ordinal]);
    const work: Invocation = { rootId, callId: JSON.stringify(["scheduler", config.id, t.ordinal, t.attempts]), attempt: t.attempts - 1, operation: config.operation, offeredAt: t.at };
    t.receipt = send(config.target, work, outcome => settle(outcome === "completed", outcome));
  };
  const launch = (t: Trigger) => { active.set(t.ordinal, t); peakActive = Math.max(peakActive, active.size); dispatch(t); };
  const offer = (t: Trigger) => {
    if (stale(t)) { missed++; record(t, "missed-late"); return; }
    if (active.size < concurrency) { launch(t); return; }
    if (config.overlap === "queue" && queue.length < queueLimit) { queue.push(t); peakQueued = Math.max(peakQueued, queue.length); return; }
    skippedOverlap++; missed++; record(t, "skipped-overlap");
  };
  const schedule = (at: number) => {
    if (at > horizon || due >= limit) return;
    clock.schedule(at, 3, JSON.stringify(["scheduler-due", config.id, due]), () => {
      const t: Trigger = { ordinal: due++, at: clock.now, attempts: 0 };
      if (paused) {
        if (config.missed === "latest") { if (latest) missed++; latest = t; }
        else missed++;
        record(t, "unavailable");
      } else offer(t);
      if (period > 0) schedule(at + period);
    });
  };
  return {
    start() { if (!started) { started = true; schedule(requireKnown(config.start, "us")); } },
    accept(_work: Invocation, done: RemoteCompletion): Receipt { rejectedInbound++; done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" }; },
    pause(value: boolean) { paused = value; if (!paused) { const t = latest; latest = undefined; if (t) offer(t); drain(); } },
    measure: () => ({ id: config.id, paused, received: rejectedInbound, admitted: 0, rejected: rejectedInbound, completed: 0, failed: 0, cancelled: 0, queued: queue.length, serving: active.size, waiting: 0, consumedCoreUs: 0, busySlotUs: 0 }),
    evidence: () => ({ id: config.id, due, fired, skippedOverlap, missed, retried, failed, completed, active: active.size, queued: queue.length, retainedLatest: latest ? 1 : 0, peakActive, peakQueued, events: events.map(r => ({ ...r })), omitted, guarantee: "Retries keep a logical invocation identity; duplicate downstream effects possible. Destination owns idempotency; exactly-once and physical scheduler availability Unknown." }),
  };
}
