import { expect, test } from "bun:test";
import { timeoutFixture } from "./attemptTimeout.fixture";
import { createProductModel2 } from "../src/internalProduct";
import { createWorkloadRuntime } from "../src/model2/workload/run";
import { quantities, workloadFixture } from "./workloadFixture";
import type { CausalEvent } from "../src/model2/workload/causal";

test("timeout retries through the real entry, recovers once and the final attempt has no timer", () => {
  const f = timeoutFixture(); f.runtime.advanceTo(1_000_000);
  const e = f.runtime.evidence();
  expect(e.clientRetry).toMatchObject({ attemptsTimedOut: 1, totalAttempts: 2, retriesScheduled: 1, retriesIssued: 1, recovered: 1, recoveredByTimeoutRetry: 1, timeoutCancellationsRequested: 1, timeoutCancellationsConfirmed: 1 });
  expect(e.counts).toMatchObject({ offered: 1, completed: 1, rejected: 0, cancellationRequested: 1, cancellationConfirmedAtEntry: 1 });
  const issued = f.events.filter(e => e.kind === "client-attempt-issued");
  expect(issued.map(e => e.atUs)).toEqual([0, 2000]);
  expect(new Set(issued.map(e => e.work!.callId)).size).toBe(2);
  expect(f.events.filter(e => e.kind === "caller-terminal")).toHaveLength(1);
  expect(f.events.find(e => e.kind === "client-attempt-terminal" && e.detail.timedOut)).toMatchObject({ atUs: 1000, detail: { outcome: "rejected", rootReason: "response-timeout", rootResource: "$caller" } });
  expect(e.results[0]!.responseUs).toBeGreaterThan(3000);
  const stepped = createProductModel2(f.compiled);
  for (let at = 100; at <= 1_000_000; at += 100) stepped.advanceTo(at);
  expect(JSON.stringify(stepped.evidence())).toBe(JSON.stringify(e));
});

test("detach leaves real superseded work running and its late completion cannot finish the root", () => {
  const f = timeoutFixture({ policy: "detach" }); f.runtime.advanceTo(1_000_000);
  const e = f.runtime.evidence();
  expect(e.clientRetry).toMatchObject({ attemptsTimedOut: 1, timeoutCancellationsRequested: 0, timeoutCancellationsConfirmed: 0, supersededOutcomes: { completed: 1, rejected: 0, cancelled: 0 }, wastedCompletions: 1, recoveredByTimeoutRetry: 1 });
  expect(e.resources.find(r => r.id === "app")!.completed).toBe(2);
  expect(e.counts.remoteOutcomesAfterCallerStop).toBe(1);
  const late = f.events.find(e => e.kind === "client-attempt-superseded-outcome")!;
  const terminal = f.events.filter(e => e.kind === "caller-terminal");
  expect(terminal).toHaveLength(1); expect(terminal[0]!.atUs).toBeGreaterThan(late.atUs);
  expect(terminal[0]!.work!.attempt).toBe(1);
});

test("honoured cancellation stops app work; unsupported server cancellation is only confirmed at entry", () => {
  const honoured = timeoutFixture(), unsupported = timeoutFixture({ unsupported: true });
  for (const f of [honoured, unsupported]) f.runtime.advanceTo(1_000_000);
  expect(honoured.events.some(e => e.kind === "app-terminal" && e.detail.outcome === "cancelled")).toBe(true);
  expect(honoured.runtime.evidence().clientRetry).toMatchObject({ timeoutCancellationsConfirmed: 1, supersededOutcomes: { completed: 0, rejected: 0, cancelled: 1 }, wastedCompletions: 0 });
  expect(unsupported.events.some(e => e.kind === "app-terminal" && e.detail.outcome === "cancelled")).toBe(false);
  expect(unsupported.runtime.evidence().resources.find(r => r.id === "app")!.completed).toBe(2);
  expect(unsupported.runtime.evidence().network.paths.some(p => p.remoteOutcomesAfterStop > 0)).toBe(true);
  // Confirmation proves the caller entry receipt stopped; hidden downstream outcomes are not invented.
  expect(unsupported.runtime.evidence().clientRetry!.timeoutCancellationsConfirmed).toBe(1);
});

test("deadline too close gives up; writes get no attempt timer", () => {
  const close = timeoutFixture({ rootTimeout: 2000 }); close.runtime.advanceTo(1_000_000);
  expect(close.runtime.evidence().clientRetry).toMatchObject({ totalAttempts: 1, attemptsTimedOut: 1, givenUp: 1 });
  expect(close.runtime.evidence().counts).toMatchObject({ rejected: 1, completed: 0 });
  const write = timeoutFixture({ write: true }); write.runtime.advanceTo(1_000_000);
  expect(write.runtime.evidence().clientRetry).toMatchObject({ totalAttempts: 1, attemptsTimedOut: 0 });
  expect(write.events.some(e => e.kind === "client-attempt-timeout")).toBe(false);
});

test("fast rejections cancel attempt timers without double processing and attempts stay bounded", () => {
  const f = timeoutFixture({ timeout: 100, queue: 0, rate: 60000, stopAt: 1001 });
  f.runtime.advanceTo(1_000_000);
  const e = f.runtime.evidence();
  expect(e.clientRetry!.attemptsTimedOut).toBe(0);
  expect(e.clientRetry!.retriesIssued).toBeGreaterThan(0);
  expect(f.events.filter(e => e.kind === "caller-terminal")).toHaveLength(e.counts.offered);
  expect(e.clientRetry!.totalAttempts).toBeLessThanOrEqual(e.counts.offered * 2);
});

test("all nonfinal attempts time out with doubling backoff and the final attempt waits for the root deadline", () => {
  const f = timeoutFixture({ attempts: 4, rootTimeout: 12000, policy: "detach" });
  // Pause the real app so no attempt can produce an outcome.
  const resource = f.compiled.input.resources.find(r => r.kind === "compute")!;
  const { q, ledger } = quantities();
  f.compiled.input.faults.push({ id: "slow", kind: "pause-service", target: resource.id, at: q("pause.at", 0, "us"), duration: q("pause.duration", 20000, "us") });
  f.compiled.input.ledger.push(...ledger);
  const events: CausalEvent[] = [];
  const run = createProductModel2(f.compiled, undefined, e => events.push(e)); run.advanceTo(1_000_000);
  expect(events.filter(e => e.kind === "client-attempt-issued").map(e => e.atUs)).toEqual([0, 2000, 5000, 10000]);
  expect(run.evidence().clientRetry).toMatchObject({ attemptsTimedOut: 3, totalAttempts: 4 });
  expect(run.evidence().results).toMatchObject([{ outcome: "deadline-exceeded", at: 12000 }]);
  expect(events.filter(e => e.kind === "caller-terminal")).toHaveLength(1);
});

test("unsupported receipts expose late rejected results exactly once; refused timer registration is not a timeout", () => {
  const input = workloadFixture({ count: 1, timeout: 10000, horizon: 20000 });
  input.failureCauseProfile = "failure-cause/1";
  input.operations[0]!.onCallerStop = "request-cancellation";
  input.operations[0]!.clientRetry = { version: 1, maxAttempts: 2, backoffMs: 1, attemptTimeoutMs: 1 };
  const run = () => createWorkloadRuntime(input, { station: (_c, _d, kernel) => ({
    accept(work, done) {
      kernel.schedule(kernel.now + 3000, 2, work.callId, () => { done(work.attempt ? "completed" : "rejected"); if (!work.attempt) done("rejected"); });
      return { admitted: true, state: () => "serving", cancel: () => "unsupported" };
    }, pause() {}, measure: () => ({ id: "app" } as never),
  }) });
  const runtime = run(); runtime.advanceTo(20000);
  expect(runtime.evidence().clientRetry).toMatchObject({ attemptsTimedOut: 1, timeoutCancellationsRequested: 1, timeoutCancellationsConfirmed: 0, supersededOutcomes: { completed: 0, rejected: 1, cancelled: 0 }, wastedCompletions: 0 });
  expect(runtime.evidence().counts.completed).toBe(1);
  input.limits.maxPendingEvents = 2;
  const bounded = run(); expect(() => bounded.advanceTo(20000)).toThrow("pending-event budget exhausted");
  expect(bounded.evidence().clientRetry).toMatchObject({ attemptsTimedOut: 0, retriesScheduled: 0 });
});
