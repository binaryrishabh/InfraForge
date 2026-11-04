import { expect, test } from "bun:test";
import { EventKernel } from "../src/model2/time";
import { scheduler } from "../src/model2/scheduled/run";
import type { SchedulerConfig } from "../src/model2/scheduled/contracts";
import type { Deliver } from "../src/model2/compute/run";
import { prepare, design } from "./asyncCanvas.fixture";

export function schedulerFixture(patch: Partial<SchedulerConfig> = {}) {
  const execution = prepare(design(false)).compiled.input.resources.find(r => r.kind === "compute")!;
  if (execution.kind !== "compute") throw Error("execution");
  const q = (value: number, unit: "us" | "count") => ({ kind: "known" as const, value, unit, provenance: ["test"] });
  return { id: "timer", kind: "scheduler", profile: "bounded-simulated-triggers/1", execution, target: "app", operation: "write", start: q(0, "us"), period: q(10000, "us"), maxTriggers: q(10, "count"), overlap: "skip", maxConcurrent: q(4, "count"), queueCapacity: q(2, "count"), maxAttempts: q(3, "count"), retryDelay: q(1000, "us"), timeout: q(50000, "us"), maxLateness: q(1000000, "us"), missed: "skip", ...patch } as SchedulerConfig;
}
function run(overlap: SchedulerConfig["overlap"], period = 10000) {
  const clock = new EventKernel(10000); let calls = 0;
  const send: Deliver = (_target, _work, done) => {
    const cancel = clock.schedule(clock.now + 25000, 2, `app-${calls++}`, () => done("completed"));
    return { admitted: true, state: () => "serving", cancel: () => { cancel(); return "cancelled"; } };
  };
  const config = schedulerFixture({ overlap }); config.period = { kind: "known", unit: "us", provenance: ["test"], value: period };
  const service = scheduler(config, clock, send, 300000); service.start(); clock.advanceTo(300000);
  return { evidence: service.evidence(), calls, pending: clock.pending };
}
test("overlap and period causally change real downstream load; replay is deterministic", () => {
  expect(run("skip").calls).toBe(4);
  expect(run("allow").calls).toBe(10);
  expect(run("queue").calls).toBe(6);
  expect(run("skip", 30000).calls).toBe(10);
  expect(run("queue")).toEqual(run("queue"));
  expect(run("queue").pending).toBe(0);
});
test("outage retries are bounded and exhausted triggers count as missed", () => {
  const clock = new EventKernel(10000); let calls = 0;
  const send: Deliver = (_t, _w, done) => { calls++; done("rejected"); return { admitted: false, state: () => "finished", cancel: () => "already-finished" }; };
  const service = scheduler(schedulerFixture(), clock, send, 300000); service.start(); clock.advanceTo(300000);
  expect(service.evidence()).toMatchObject({ due: 10, fired: 30, retried: 20, failed: 10, missed: 10, completed: 0, active: 0, queued: 0 });
  expect(calls).toBe(30); expect(clock.pending).toBe(0);
});
test("ambiguous timeout preserves the logical id while late replies cannot double-complete", () => {
  const clock = new EventKernel(10000), ids: string[] = [];
  const send: Deliver = (_t, w, done) => { ids.push(w.rootId); clock.schedule(clock.now + 60000, 2, w.callId, () => done("completed")); return { admitted: true, state: () => "serving", cancel: () => "unsupported" }; };
  const config = schedulerFixture(); config.period = { kind: "known", unit: "us", provenance: ["test"], value: 0 };
  const service = scheduler(config, clock, send, 300000); service.start(); service.start(); clock.advanceTo(300000);
  expect(ids).toHaveLength(3); expect(new Set(ids).size).toBe(1);
  expect(service.evidence()).toMatchObject({ due: 1, fired: 3, failed: 1, completed: 0, missed: 1 });
  expect(service.evidence().guarantee).toContain("duplicate");
});
test("missed latest retains only one trigger, resumes once and respects lateness", () => {
  const clock = new EventKernel(10000); let calls = 0;
  const send: Deliver = (_t, _w, done) => { calls++; done("completed"); return { admitted: true, state: () => "finished", cancel: () => "already-finished" }; };
  const service = scheduler(schedulerFixture({ missed: "latest" }), clock, send, 300000);
  service.pause(true); service.start(); clock.advanceTo(95000); expect(calls).toBe(0);
  service.pause(false); expect(calls).toBe(1); expect(service.evidence()).toMatchObject({ missed: 9, completed: 1 });
  expect(clock.pending).toBe(0);
});
test("skip misses do not replay, and an expired latest trigger cannot catch up", () => {
  for (const missed of ["skip", "latest"] as const) {
    const clock = new EventKernel(10000); let calls = 0;
    const send: Deliver = (_t, _w, done) => { calls++; done("completed"); return { admitted: true, state: () => "finished", cancel: () => "already-finished" }; };
    const config = schedulerFixture({ missed, maxLateness: { kind: "known", unit: "us", value: 0, provenance: ["test"] } });
    const service = scheduler(config, clock, send, 300000); service.pause(true); service.start(); clock.advanceTo(95000); service.pause(false);
    expect(service.evidence()).toMatchObject({ due: 10, missed: 10, retainedLatest: 0 }); expect(calls).toBe(0);
  }
});

test("regression: future triggers and event evidence stay bounded as the trigger limit grows", () => {
  const run = (limit: number) => {
    const clock = new EventKernel(30000, 4);
    const send: Deliver = (_t, _w, done) => { done("completed"); return { admitted: true, state: () => "finished", cancel: () => "already-finished" }; };
    const q = <U extends "us" | "count">(value: number, unit: U) => ({ kind: "known" as const, value, unit, provenance: ["test"] });
    const service = scheduler(schedulerFixture({ period: q(1, "us"), maxTriggers: q(limit, "count") }), clock, send, 20000);
    service.start(); expect(clock.pending).toBe(1); clock.advanceTo(20000);
    return { evidence: service.evidence(), readings: service.readings(), peakPending: clock.peakPending, pending: clock.pending };
  };
  const small = run(100), large = run(10000);
  expect(small.evidence.completed).toBe(100); expect(large.evidence.completed).toBe(10000);
  expect(large.readings.attemptAccounting.started).toBe(10000);
  expect(large.peakPending).toBe(small.peakPending); expect(large.peakPending).toBeLessThanOrEqual(2);
  expect(large.pending).toBe(0); expect(large.evidence.events).toHaveLength(2048); expect(large.evidence.omitted).toBe(7952);
});

test("retry waiting and timeout attempts remain distinct until the required retry delay elapses", () => {
  const clock = new EventKernel(10000);
  const send: Deliver = () => ({ admitted: true, state: () => "serving", cancel: () => "unsupported" });
  const service = scheduler(schedulerFixture({ period: { kind: "known", unit: "us", value: 0, provenance: ["test"] } }), clock, send, 300000);
  service.start(); clock.advanceTo(50000);
  expect(service.readings().attemptAccounting).toMatchObject({ started: 1, failedAttempts: 1, timedOutAttempts: 1, pendingAttempts: 0, retryWaiting: 1 });
  service.pause(true); clock.advanceTo(50500); service.pause(false);
  expect(service.readings().fired).toBe(1);
  clock.advanceTo(51000);
  expect(service.readings().attemptAccounting).toMatchObject({ started: 1, failedAttempts: 1, pendingAttempts: 1, retryWaiting: 0 });
  clock.advanceTo(300000);
  expect(service.readings().attemptAccounting).toMatchObject({ started: 1, failedAttempts: 3, timedOutAttempts: 3, pendingAttempts: 0, retryWaiting: 0 });
});
