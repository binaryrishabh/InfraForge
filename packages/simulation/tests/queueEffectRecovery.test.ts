import { expect, test } from "bun:test";
import { effectRecovery } from "./queueEffectRecovery.fixture";
import { createProductModel2 } from "../src/model2/product/run";

test("delayed compiled job loses its worker after the object write; lease redelivery repeats only unprotected effects", () => {
  const outcomes = [false, true].map(idempotent => {
    const f = effectRecovery(idempotent);
    f.runtime.advanceTo(900000);
    expect(f.runtime.evidence().asynchronous.brokers[0]!.scheduled).toBe(1);
    expect(f.runtime.evidence().asynchronous.workers[0]!.deliveries).toBe(0);
    f.runtime.advanceTo(1400000);
    const before = f.runtime.evidence().asynchronous;
    expect(before.workers[0]!.effects).toBe(1);
    expect(before.brokers[0]!.acknowledged).toBe(0);
    expect(before.objects[0]!.objects.filter(o => o.namespace === "results")).toHaveLength(1);
    f.runtime.advanceTo(1600000);
    expect(f.runtime.evidence().asynchronous.workers[0]!.lostOnCrash).toBe(1);
    expect(f.runtime.evidence().asynchronous.workers[0]!.available).toBe(false);
    f.runtime.advanceTo(f.runtime.horizon);
    const e = f.runtime.evidence(), q = e.asynchronous.brokers[0]!, w = e.asynchronous.workers[0]!;
    expect(q.leaseExpired).toBeGreaterThan(0);
    expect(q.redelivered).toBeGreaterThan(0);
    expect(q.acknowledged).toBe(q.accepted);
    expect(q.ready + q.scheduled + q.inFlight + q.deadLettered + q.discarded + q.expired).toBe(0);
    expect(w.active + w.creditOwnedLocally).toBe(0);
    expect(e.counts.completed + e.counts.rejected).toBe(e.counts.offered);
    expect(w.events.find(row => row.kind === "object-effect")!.at).toBeLessThan(1500000);
    const replay = createProductModel2(f.compiled);
    for (let at = 250000; at <= replay.horizon; at += 250000) replay.advanceTo(at);
    expect(replay.evidence()).toEqual(e);
    return e.asynchronous;
  });
  const [off, on] = outcomes;
  expect(off!.workers[0]!.effects).toBeGreaterThan(on!.workers[0]!.effects);
  expect(on!.workers[0]!.effects).toBe(1);
  expect(on!.workers[0]!.deduplicated).toBeGreaterThan(0);
  expect(off!.objects[0]!.replacedObjects).toBeGreaterThan(on!.objects[0]!.replacedObjects);
  const control = effectRecovery(false, false); control.runtime.advanceTo(control.runtime.horizon);
  expect(control.runtime.evidence().asynchronous.brokers[0]!.redelivered).toBe(0);
  expect(control.runtime.evidence().asynchronous.workers[0]!.effects).toBe(1);
  console.info("compiled-queue-effect-window", JSON.stringify(outcomes.map(e => ({ effects: e.workers[0]!.effects, deduplicated: e.workers[0]!.deduplicated, lost: e.workers[0]!.lostOnCrash, redelivered: e.brokers[0]!.redelivered, acknowledged: e.brokers[0]!.acknowledged, replaced: e.objects[0]!.replacedObjects }))));
});

test("delayed poison jobs consume bounded prefetch and attempts; DLQ capacity changes discards without object effects", () => {
  const outcomes = [1, 4].map(capacity => {
    const f = effectRecovery(true, false, true, capacity);
    const originalObjects = f.runtime.evidence().asynchronous.objects[0]!.objects;
    let peakCredit = 0;
    for (let at = 10000; at <= f.runtime.horizon; at += 10000) {
      f.runtime.advanceTo(at);
      const w = f.runtime.inspectWorker("worker")!;
      peakCredit = Math.max(peakCredit, w.creditOwnedLocally);
      expect(w.creditOwnedLocally).toBeLessThanOrEqual(4);
      expect(w.active).toBeLessThanOrEqual(1);
    }
    const e = f.runtime.evidence().asynchronous, q = e.brokers[0]!, w = e.workers[0]!;
    expect(peakCredit).toBeGreaterThan(1);
    expect(q.deadLettered).toBeLessThanOrEqual(capacity);
    expect(q.accepted).toBe(q.deadLettered + q.discarded);
    expect(q.dlqOverflow).toBe(q.discarded);
    expect(q.dlq.every(row => row.message.attempts === 3 && row.reason === "attempt-limit")).toBe(true);
    expect(w.failed).toBe(q.accepted * 3);
    expect(w.effects).toBe(0);
    expect(e.objects[0]!.objects.filter(o => o.namespace !== "uploads")).toEqual(originalObjects);
    expect(e.objects[0]!.objects.filter(o => o.namespace === "results")).toEqual([]);
    return { accepted: q.accepted, retained: q.deadLettered, discarded: q.discarded, failed: w.failed, peakCredit };
  });
  expect(outcomes[0]!.accepted).toBe(outcomes[1]!.accepted);
  expect(outcomes[1]!.discarded).toBeLessThan(outcomes[0]!.discarded);
  console.info("compiled-queue-delayed-poison", JSON.stringify(outcomes));
});
