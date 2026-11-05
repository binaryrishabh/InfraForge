import { describe, expect, test } from "bun:test";
import type { ChallengeDefinition, ChallengeStarter } from "@infraforge/contracts/challenges";
import { whereDoesTheTimeGoV1 } from "../challenges/definitions/where-does-the-time-go/v1";
import { waitingWithSpareCpuV1 } from "../challenges/definitions/waiting-with-spare-cpu/v1";
import { oneBiggerOrTwoSmallerV1 } from "../challenges/definitions/one-bigger-or-two-smaller/v1";
import { buildRegistry, challengeSeed, specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { preflight } from "../challenges/preflight";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRunReport } from "../reports/report";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";

const labs = [whereDoesTheTimeGoV1, waitingWithSpareCpuV1, oneBiggerOrTwoSmallerV1];
const prediction = (d: ChallengeDefinition) => answers(d, {"overall-health": "healthy", "busiest-type": "Virtual Machine"});
const run = (d: ChallengeDefinition, design: ChallengeStarter) => attemptRow(d, design, prediction(d));
const cpu = (r: ReturnType<typeof buildRunReport>, id: string) => r.terminal!.resources.find(resource => resource.id === id)!.cpu!;
const latency = (r: ReturnType<typeof buildRunReport>) => r.terminal!.traffic!.latencyMs.p95!;
const monthly = (r: ReturnType<typeof buildRunReport>) => r.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd!;

describe("first runnable labs: controlled Model 2 evidence", () => {
  for (const d of labs) test(`${d.id}: one-setting fix passes, wrong resource still fails`, () => {
    const start = d.starter!, fixed = REFERENCE[d.id]!;
    // Undo exactly the one intended setting; every other byte of design stays equal.
    const restored = structuredClone(fixed), restoredApp = restored.resources.find(r => r.id === "app")!;
    const originalApp = start.resources.find(r => r.id === "app")!;
    if (d.id === "waiting-with-spare-cpu") restoredApp.vmExecution = originalApp.vmExecution;
    else if (originalApp.skuId === undefined) delete restoredApp.skuId;
    else restoredApp.skuId = originalApp.skuId;
    expect(restored).toEqual(start);
    expect(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(fixed, d.workload, challengeSeed(d)).workloadProfile);
    const wrong: ChallengeStarter = {...start, resources: start.resources.map(r =>
      r.id === (d.id === "waiting-with-spare-cpu" ? "app" : "db") ? {...r, skuId: d.id === "waiting-with-spare-cpu" ? "c5.xlarge" : "db.m5.xlarge"} : r)};
    expect(preflight(d, start).valid).toBe(true);
    expect(preflight(d, fixed).valid).toBe(true);
    expect(preflight(d, wrong).valid).toBe(true);
    const starterRow = run(d, start), referenceRow = run(d, fixed);
    const before = buildRunReport(starterRow), after = buildRunReport(referenceRow), near = buildRunReport(run(d, wrong));
    expect(before.challenge?.status).toBe("not-met");
    expect(after.challenge?.criteria.every(c => c.status === "met")).toBe(true);
    expect(after.challenge?.status).toBe("met");
    expect(near.challenge?.status).toBe("not-met");
    expect(latency(before)).toBeGreaterThan(400);
    expect(latency(after)).toBeLessThan(10);
    expect(latency(near)).toBeGreaterThan(400);
    expect(before.terminal!.traffic!.completedRps).toBeLessThan(after.terminal!.traffic!.completedRps);
    expect(after.terminal!.traffic!.failedRps).toBe(0);
    expect(after.terminal!.simulatedSeconds).toBe(12);
    expect(before.challenge?.predictions.every(p => p.actual !== null)).toBe(true);
    expect(after.challenge?.predictions.every(p => p.actual !== null)).toBe(true);
    if (d.id === "waiting-with-spare-cpu") {
      expect(before.terminal!.health).toBe("healthy");
      expect(cpu(before, "app")).toBeLessThan(80);
      expect(cpu(near, "app")).toBeLessThan(cpu(before, "app") / 2);
      expect(latency(near)).toBe(latency(before));
      expect(cpu(after, "app")).toBeGreaterThan(cpu(before, "app"));
    } else {
      expect(cpu(before, "app")).toBe(100);
      expect(cpu(after, "app")).toBeLessThan(70);
      expect(cpu(near, "app")).toBe(100);
      expect(cpu(near, "db")).toBeLessThan(cpu(before, "db"));
      expect(before.challenge?.predictions[0]?.actual).toBe("Virtual Machine");
    }
    console.info(JSON.stringify({lab: d.id, second: 12, before: {cpu: cpu(before, "app"), p95Ms: latency(before), completedRps: before.terminal!.traffic!.completedRps, estimateUsd: monthly(before)},
      after: {cpu: cpu(after, "app"), p95Ms: latency(after), completedRps: after.terminal!.traffic!.completedRps, estimateUsd: monthly(after)}, nearMissP95Ms: latency(near)}));

    // All mutations begin with a real passing run, never a hand-authored expected report.
    for (const mutate of [
      (row: typeof referenceRow) => { row.terminalSnapshot = null; },
      (row: typeof referenceRow) => { (row.terminalSnapshot as {simulatedSeconds: number}).simulatedSeconds = 11; },
      (row: typeof referenceRow) => { (row.terminalSnapshot as {traffic?: unknown}).traffic = undefined; },
      (row: typeof referenceRow) => { (row.terminalSnapshot as {metricsTopologyRevision: number}).metricsTopologyRevision = 99; },
    ]) {
      const row = structuredClone(referenceRow); mutate(row);
      expect(buildRunReport(row).challenge?.criteria.find(c => c.id === "latency")?.status).toBe("not-evaluated");
    }
    for (const bad of [null, -1, NaN, Infinity]) {
      const row = structuredClone(referenceRow);
      (row.terminalSnapshot as {traffic: {latencyMs: {p95: number | null}}}).traffic.latencyMs.p95 = bad;
      expect(buildRunReport(row).challenge?.criteria.find(c => c.id === "latency")?.status).toBe("not-evaluated");
    }
    const noCompletions = structuredClone(referenceRow);
    (noCompletions.terminalSnapshot as {traffic: {completedRps: number}}).traffic.completedRps = 0;
    expect(buildRunReport(noCompletions).challenge?.criteria.find(c => c.id === "latency")?.status).toBe("not-evaluated");
    const mismatched = structuredClone(referenceRow); mismatched.challengeSpecHash = "0".repeat(64);
    expect(buildRunReport(mismatched).challenge?.status).toBe("unavailable");
  }, 120000);

  test("one unchanged design passes at 300/s and fails at 800/s; vertical and horizontal alternatives both pass", () => {
    const d = oneBiggerOrTwoSmallerV1;
    const low = {...d, workload: {...d.workload, targetThroughput: 18000}};
    expect({...low, workload: d.workload}).toEqual(d);
    expect(challengeSeed(low)).toBe(challengeSeed(d));
    const lowReport = buildRunReport(run(low, d.starter!), buildRegistry([low]));
    const high = buildRunReport(run(d, d.starter!));
    const vertical = buildRunReport(run(d, REFERENCE[d.id]!));
    const horizontalDesign = REFERENCE[`${d.id}-horizontal`]!;
    expect(horizontalDesign.resources.filter(r => r.id !== "app2")).toEqual(d.starter!.resources);
    expect(horizontalDesign.connectionLines.filter(e => !e.id.includes("app2"))).toEqual(d.starter!.connectionLines);
    const horizontal = buildRunReport(run(d, horizontalDesign));
    expect(lowReport.challenge?.status).toBe("met");
    expect(high.challenge?.status).toBe("not-met");
    expect(latency(high)).toBeGreaterThan(latency(lowReport) * 20);
    expect(lowReport.terminal!.traffic!.completedRps).toBe(300);
    expect(vertical.challenge?.status).toBe("met");
    expect(horizontal.challenge?.status).toBe("met");
    expect(horizontal.terminal!.traffic!.completedRps).toBe(vertical.terminal!.traffic!.completedRps);
    expect(monthly(horizontal)).toBe(monthly(vertical));
    expect(monthly(vertical)).toBeGreaterThan(monthly(high));
    expect(horizontal.actions).toEqual([]);
    expect(vertical.actions).toEqual([]);
    expect(horizontal.terminal!.resources.filter(r => r.id.startsWith("app"))).toHaveLength(2);
    console.info(JSON.stringify({lab: d.id, control: {rate: 300, cpu: cpu(lowReport, "app"), p95Ms: latency(lowReport), estimateUsd: monthly(lowReport)},
      horizontal: {cpu: cpu(horizontal, "app"), p95Ms: latency(horizontal), completedRps: horizontal.terminal!.traffic!.completedRps, estimateUsd: monthly(horizontal)}}));
  }, 120000);

  test("latency criteria refuse unsupported engines and invalid limits; invalid worker settings cannot run", () => {
    const d = waitingWithSpareCpuV1;
    for (const maxMs of [0, -1, NaN, Infinity]) {
      const bad = {...d, criteria: [{id: "latency", kind: "terminal-p95" as const, label: "Latency", maxMs}]};
      expect(validateChallengeVersions([bad], {[`${d.id}@1`]: specHash(bad)})).toContainEqual(expect.stringContaining("positive finite maxMs"));
    }
    const legacy = {...d, engine: undefined};
    expect(validateChallengeVersions([legacy], {[`${d.id}@1`]: specHash(legacy)})).toContainEqual(expect.stringContaining("needs Model 2"));
    const bad = {...d.starter!, resources: d.starter!.resources.map(r => r.id === "app" ? {...r, vmExecution: {version: 1 as const, workers: 0}} : r)};
    expect(() => captureRunInputs(bad, d.workload)).toThrow();
    expect(preflight(d, bad).valid).toBe(false);
  });
});
