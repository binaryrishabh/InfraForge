import { expect, test } from "bun:test";
import { createWorkloadRuntime } from "../src/model2/workload/run";
import { seedCause } from "../src/model2/workload/cause";
import { workloadFixture } from "./workloadFixture";
import { createLiveModel2 } from "../src/model2/product/live";
import { lbDesign, prepareLb } from "./lbAdmission.fixture";

test("retry evidence counts originals once, per-attempt outcomes, recovery and full root latency", () => {
  const input = workloadFixture({ count: 1, horizon: 10000 }); input.failureCauseProfile = "failure-cause/1";
  input.operations[0]!.clientRetry = { version: 1, maxAttempts: 3, backoffMs: 1 };
  const runtime = createWorkloadRuntime(input, { station: () => ({
    accept(work, done) { done(work.attempt ? "completed" : "rejected", work.attempt ? undefined : seedCause("reset", "app")); return { admitted: true, state: () => "finished", cancel: () => "already-finished" }; },
    pause() {}, measure: () => ({ id: "app" } as never),
  }) });
  runtime.advanceTo(10000); const e = runtime.evidence();
  expect(e.counts).toMatchObject({ offered: 1, admitted: 1, completed: 1, rejected: 0 });
  expect(e.clientRetry).toMatchObject({ originalsOffered: 1, totalAttempts: 2, retriesScheduled: 1, retriesIssued: 1, recovered: 1, exhausted: 0, givenUp: 0, extraLoadFactor: 2,
    perAttemptOutcomes: [{ attempt: 0, issued: 1, rejected: 1, completed: 0 }, { attempt: 1, issued: 1, completed: 1, rejected: 0 }, { attempt: 2, issued: 0 }] });
  expect(e.results[0]!.responseUs).toBe(1000);
});

test("live retry counters are optional and offered RPS and latency remain rooted at the originals", () => {
  const d = lbDesign(); d.resources[1]!.vmExecution = { version: 1, workers: 1, queuedRequests: 0 };
  const off = prepareLb(d), historical = createLiveModel2(off.compiled, ["lb", "app"]);
  historical.advanceSecond(); const oldView = historical.project(); expect(oldView).not.toHaveProperty("clientRetry"); expect(historical.evidence()).not.toHaveProperty("clientRetry");
  d.workload.clientRetry = { version: 1, maxAttempts: 3, backoffMs: 50 };
  const on = prepareLb(d), live = createLiveModel2(on.compiled, ["lb", "app"]);
  live.advanceSecond(); const view = live.project(), e = live.evidence();
  expect(view.offeredRps).toBe(oldView.offeredRps);
  expect(view.clientRetry!.attemptRps).toBeGreaterThan(view.offeredRps);
  expect(view.clientRetry!.totalAttempts).toBe(e.clientRetry!.totalAttempts);
  expect(view.clientRetry!.retriesIssued).toBe(e.clientRetry!.retriesIssued);
  const completed = e.results.filter(r => r.outcome === "completed").map(r => r.responseUs).sort((a,b) => a-b);
  for (const [key, p] of [["p50", 0.5], ["p95", 0.95], ["p99", 0.99]] as const) expect(view.latencyMs[key]).toBe(completed[Math.ceil(completed.length*p)-1]! / 1000);
});
