import { describe, expect, test } from "bun:test";
import type { ChallengeDefinition, ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { routeAroundASlowVmV1 as selection } from "../challenges/definitions/route-around-a-slow-vm/v1";
import { leaveRoomForABurstV1 as burst } from "../challenges/definitions/leave-room-for-a-burst/v1";
import { retryingAFullPoolV1 as retry } from "../challenges/definitions/retrying-a-full-pool/v1";
import { buildRegistry, challengeSeed, specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { preflight } from "../challenges/preflight";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRunReport } from "../reports/report";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";

const run = (d: ChallengeDefinition, design: ChallengeStarter) => attemptRow(d, design, answers(d, {"overall-health": "healthy"}));
const cpu = (r: ReturnType<typeof buildRunReport>, id: string) => r.terminal!.resources.find(resource => resource.id === id)!.cpu!;
const traffic = (r: ReturnType<typeof buildRunReport>) => r.terminal!.traffic!;
const monthly = (r: ReturnType<typeof buildRunReport>) => r.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd!;
const metric = (r: ReturnType<typeof buildRunReport>, id: string) => r.terminal!.resources.find(resource => resource.id === id)!;
const summary = (r: ReturnType<typeof buildRunReport>) => ({status: r.challenge!.status, second: r.terminal!.simulatedSeconds,
  p50Ms: traffic(r).latencyMs.p50, p95Ms: traffic(r).latencyMs.p95, offeredRps: traffic(r).offeredRps,
  completedRps: traffic(r).completedRps, failedRps: traffic(r).failedRps, educationalMonthlyUsd: monthly(r), resources: r.terminal!.resources});

describe("scaling labs: controlled real Model 2 runs", () => {
  for (const d of [selection, burst, retry]) test(`${d.id}: one-setting reference passes; near miss fails`, () => {
    const start = d.starter!, fixed = REFERENCE[d.id]!;
    const restored = structuredClone(fixed);
    if (d.id === selection.id) restored.resources.find(r => r.id === "lb")!.lbSelection = start.resources.find(r => r.id === "lb")!.lbSelection;
    else if (d.id === burst.id) delete restored.resources.find(r => r.id === "app")!.skuId;
    else restored.resources.find(r => r.id === "lb")!.retry!.maxAttempts = 5;
    expect(restored).toEqual(start);
    expect(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(fixed, d.workload, challengeSeed(d)).workloadProfile);
    const near = structuredClone(start);
    if (d.id === selection.id) near.resources.find(r => r.id === "fast")!.skuId = "c5.xlarge";
    else if (d.id === burst.id) near.resources.find(r => r.id === "app")!.vmExecution = {version: 1, queuedRequests: 1000};
    else near.resources.find(r => r.id === "lb")!.retry!.maxAttempts = 4;
    for (const design of [start, fixed, near]) expect(preflight(d, design).valid).toBe(true);
    const beforeRow = run(d, start), afterRow = run(d, fixed);
    const before = buildRunReport(beforeRow), after = buildRunReport(afterRow), wrong = buildRunReport(run(d, near));
    expect(before.challenge!.status).toBe("not-met");
    expect(after.challenge!.status).toBe("met");
    expect(after.challenge!.criteria.every(c => c.status === "met")).toBe(true);
    expect(wrong.challenge!.status).toBe("not-met");
    expect(after.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
    if (d.id === retry.id) {
      const admissions = (r: typeof before) => { const a = metric(r, "lb").lbAccounting!; return a.acceptedByBackend + a.rejectedByVm; };
      const offered = (r: typeof before) => { const w = traffic(r).wholeRun!; return w.completed + w.failed + w.deadlineExceeded + w.abandoned + w.inFlight; };
      expect(offered(before)).toBe(1200); expect(offered(after)).toBe(offered(before));
      expect(admissions(before) / offered(before)).toBeGreaterThan(3.5);
      expect(admissions(after) / offered(after)).toBeLessThan(1.7);
      expect(admissions(wrong) / offered(wrong)).toBeGreaterThan(2.5);
      expect(metric(after, "lb").lbAccounting!.acceptedByBackend).toBeGreaterThan(0);
      expect(metric(after, "lb").lbAccounting!.rejectedByVm).toBeLessThan(metric(before, "lb").lbAccounting!.rejectedByVm / 2);
      expect(traffic(after).completedRps).toBe(traffic(before).completedRps);
      expect(traffic(after).failedRps).toBeGreaterThan(0);
      expect(cpu(after, "app")).toBe(cpu(before, "app"));
      expect(after.terminal!.health).toBe("critical");
      expect(monthly(after)).toBe(monthly(before));
      expect(after.challenge!.criteria.find(c => c.id === "amplification")!.detail).toContain("Queue counts overlap");
    } else {
      expect(traffic(before).latencyMs.p95!).toBeGreaterThan(700);
      expect(traffic(after).latencyMs.p95!).toBeLessThan(10);
      expect(traffic(wrong).latencyMs.p95!).toBeGreaterThan(700);
      expect(traffic(after).completedRps).toBeGreaterThan(traffic(before).completedRps);
      expect(traffic(after).failedRps).toBe(0);
      if (d.id === selection.id) {
        expect(before.terminal!.resources.every(r => r.health === "healthy")).toBe(true);
        expect(cpu(before, "slow")).toBe(25);
        expect(traffic(before).latencyMs.p50!).toBeLessThan(10);
        expect(traffic(before).latencyMs.p95!).toBeGreaterThan(traffic(before).latencyMs.p50! * 100);
        expect(metric(after, "fast").rps!).toBeGreaterThan(metric(before, "fast").rps!);
        expect(metric(after, "slow").rps!).toBeLessThan(metric(before, "slow").rps!);
        expect(metric(before, "lb").lbAccounting!.queuedAtVm).toBeGreaterThan(0);
        expect(metric(after, "lb").lbAccounting!.queuedAtVm).toBe(0);
        expect(monthly(after)).toBe(monthly(before));
      } else {
        expect(cpu(before, "app")).toBe(100);
        expect(cpu(after, "app")).toBe(60);
        expect(traffic(before).wholeRun!.inFlight).toBeGreaterThan(0);
        expect(monthly(after)).toBeGreaterThan(monthly(before));
      }
    }
    console.info(JSON.stringify({lab: d.id, before: summary(before), after: summary(after), nearMiss: summary(wrong)}));

    // Refuse missing and stale evidence from a real passing run.
    for (const mutate of [
      (row: typeof afterRow) => { row.terminalSnapshot = null; },
      (row: typeof afterRow) => { (row.terminalSnapshot as SimulationSnapshot).simulatedSeconds--; },
      (row: typeof afterRow) => { (row.terminalSnapshot as SimulationSnapshot).traffic = undefined; },
      (row: typeof afterRow) => { (row.terminalSnapshot as {metricsTopologyRevision: number}).metricsTopologyRevision = 99; },
    ]) {
      const row = structuredClone(afterRow); mutate(row);
      expect(buildRunReport(row).challenge!.criteria.find(c => c.id === (d.id === retry.id ? "amplification" : "latency"))!.status).toBe("not-evaluated");
    }
    const mismatch = structuredClone(afterRow); mismatch.challengeSpecHash = "0".repeat(64);
    expect(buildRunReport(mismatch).challenge!.status).toBe("unavailable");
  }, 120000);

  test("burst threshold and cost: same small VM passes without burst; two catalog sizes pass with different headroom", () => {
    const steady = {...burst, workload: {...burst.workload, trafficShape: "steady" as const}};
    expect({...steady, workload: burst.workload}).toEqual(burst);
    expect(challengeSeed(steady)).toBe(challengeSeed(burst));
    const baseline = buildRunReport(run(steady, burst.starter!), buildRegistry([steady]));
    const medium = buildRunReport(run(burst, REFERENCE[burst.id]!));
    const large = buildRunReport(run(burst, REFERENCE[`${burst.id}-large`]!));
    const restored = structuredClone(REFERENCE[`${burst.id}-large`]!);
    restored.resources.find(r => r.id === "app")!.skuId = "c5.large";
    expect(restored).toEqual(REFERENCE[burst.id]!);
    for (const r of [baseline, medium, large]) expect(r.challenge!.status).toBe("met");
    expect(cpu(baseline, "app")).toBe(30);
    expect(traffic(baseline).completedRps).toBe(100);
    expect(traffic(medium).completedRps).toBe(400);
    expect(traffic(large).completedRps).toBe(traffic(medium).completedRps);
    expect(traffic(large).latencyMs.p95).toBe(traffic(medium).latencyMs.p95);
    expect(cpu(large, "app")).toBeLessThan(cpu(medium, "app"));
    expect(monthly(large)).toBeGreaterThan(monthly(medium));
    console.info(JSON.stringify({lab: burst.id, steadyControl: summary(baseline), medium: summary(medium), large: summary(large)}));
  }, 120000);
});

test("backend admission budget refuses absent, invalid, stale, zero-offered or incomplete counters", () => {
  const passing = run(retry, REFERENCE[retry.id]!);
  const snapshot = (row: typeof passing) => row.terminalSnapshot as SimulationSnapshot;
  const result = (row: typeof passing) => buildRunReport(row).challenge!.criteria.find(c => c.id === "amplification")!;
  for (const mutate of [
    (r: typeof passing) => { snapshot(r).traffic!.wholeRun = undefined; },
    (r: typeof passing) => { snapshot(r).traffic!.wholeRun!.throughSecond--; },
    (r: typeof passing) => { snapshot(r).metrics.lb!.lbAccounting = undefined; },
    (r: typeof passing) => { delete snapshot(r).metrics.lb; },
    (r: typeof passing) => { const w = snapshot(r).traffic!.wholeRun!; Object.assign(w, {completed: 0, failed: 0, deadlineExceeded: 0, abandoned: 0, inFlight: 0}); },
    (r: typeof passing) => { r.runInputs = null; r.liveTopology = null; },
    (r: typeof passing) => { const input = r.runInputs as {resources: Array<{id: string; type: string; x: number; y: number}>}; input.resources.push({id: "missing-lb", type: "Load Balancer", x: 0, y: 0}); },
  ]) {
    const row = structuredClone(passing); mutate(row);
    expect(result(row).status).toBe("not-evaluated");
  }
  for (const bad of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const row = structuredClone(passing); snapshot(row).metrics.lb!.lbAccounting!.acceptedByBackend = bad;
    expect(result(row).status).toBe("not-evaluated");
  }
  const unsafe = structuredClone(passing); snapshot(unsafe).traffic!.wholeRun!.failed = Number.MAX_SAFE_INTEGER;
  expect(result(unsafe).status).toBe("not-evaluated");
  const unsafeAdmissions = structuredClone(passing); snapshot(unsafeAdmissions).metrics.lb!.lbAccounting!.acceptedByBackend = Number.MAX_SAFE_INTEGER;
  expect(result(unsafeAdmissions).status).toBe("not-evaluated");
  const active = structuredClone(passing); active.runtimeActive = true; active.terminalSnapshot = null;
  expect(result(active).status).toBe("pending");
  // Classification changes preserve the offered population; every outcome counts.
  const partitioned = structuredClone(passing), w = snapshot(partitioned).traffic!.wholeRun!;
  const failed = w.failed; w.failed = 0; w.deadlineExceeded = failed - 1; w.abandoned = 1;
  expect(result(partitioned).detail).toBe(result(passing).detail);
  const noLb = structuredClone(passing);
  (noLb.runInputs as {resources: Array<{type: string}>}).resources = (noLb.runInputs as {resources: Array<{type: string}>}).resources.filter(r => r.type !== "Load Balancer");
  expect(result(noLb).status).toBe("not-met");
});

test("backend admission authoring rejects unsupported engines and invalid budgets; invalid policies refuse deployment", () => {
  for (const maxPerOfferedRequest of [0, -1, NaN, Infinity]) {
    const d = {...retry, criteria: [{id: "amplification", kind: "backend-admission-budget" as const, label: "Budget", maxPerOfferedRequest}]};
    expect(validateChallengeVersions([d], {[`${d.id}@1`]: specHash(d)})).toContainEqual(expect.stringContaining("positive finite maxPerOfferedRequest"));
  }
  const unsupported = {...retry, engine: undefined};
  expect(validateChallengeVersions([unsupported], {[`${retry.id}@1`]: specHash(unsupported)})).toContainEqual(expect.stringContaining("needs Model 2"));
  const badSelection = structuredClone(selection.starter!);
  badSelection.resources.find(r => r.id === "lb")!.lbSelection = {version: 1, policy: "random" as "round-robin"};
  expect(preflight(selection, badSelection).valid).toBe(false);
  expect(() => captureRunInputs(badSelection, selection.workload)).toThrow();
  const badRetry = structuredClone(retry.starter!); badRetry.resources.find(r => r.id === "lb")!.retry!.maxAttempts = 6;
  expect(preflight(retry, badRetry).valid).toBe(false);
  expect(() => captureRunInputs(badRetry, retry.workload)).toThrow();
});
