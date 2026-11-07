import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { buildRunReport } from "../reports/report";
import { answers, attemptRow, definition, REFERENCE } from "./challengeHarness";

const d = definition("open-and-size-an-api"), reference = REFERENCE[d.id]!, headroom = REFERENCE[`${d.id}-headroom`]!;
const prediction = answers(d, {"overall-health": "healthy"});
const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
const status = (r: ReturnType<typeof buildRunReport>, id: string) => r.challenge!.criteria.find(c => c.id === id)!.status;
const raw = (r: ReturnType<typeof attemptRow>) => r.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};

test("mission ladder: two independent concepts, two passing designs and a near miss failing exactly one requirement", () => {
  const start = d.starter!, policyOnly = structuredClone(reference), capacityOnly = structuredClone(reference);
  delete resource(policyOnly, "app").skuId;
  resource(capacityOnly, "fw").firewallSettings!.rules[0]!.priority = 0;
  const restore = structuredClone(policyOnly); resource(restore, "fw").firewallSettings!.rules[0]!.priority = 0;
  expect(restore).toEqual(start);
  const leaves = (a: unknown, b: unknown): number => {
    if (a === b) return 0;
    if (a && b && typeof a === "object" && typeof b === "object") return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .reduce((n, k) => n + leaves((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]), 0);
    return 1;
  };
  for (const [a, b] of [[start, policyOnly], [start, capacityOnly], [policyOnly, reference], [capacityOnly, reference], [reference, headroom]]) expect(leaves(a, b)).toBe(1);
  expect(validateInfrastructureName(d.title)).toBeNull(); expect(d.criteria).toHaveLength(3); expect(d.concepts).toHaveLength(2);
  const designs = [start, policyOnly, capacityOnly, reference, headroom];
  const control = captureRunInputs(start, d.workload, challengeSeed(d));
  const reports = designs.map(s => {
    expect(preflight(d, s).errors).toEqual([]);
    const input = captureRunInputs(s, d.workload, challengeSeed(d));
    expect(input.seed).toBe(control.seed); expect(input.workloadProfile).toEqual(control.workloadProfile); expect(input.catalogSnapshot).toBe(control.catalogSnapshot);
    expect(s.connectionLines).toEqual(start.connectionLines); expect(resource(s, "db")).toEqual(resource(start, "db"));
    return buildRunReport(attemptRow(d, s, prediction));
  });
  const [before, policy, capacity, combined, extra] = reports as [typeof reports[number], typeof reports[number], typeof reports[number], typeof reports[number], typeof reports[number]];
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "not-met", "not-met", "met", "met"]);
  expect(before.terminal!.traffic!.wholeRun!.completed).toBe(0);
  expect(before.terminal!.resources.find(r => r.id === "fw")!.security!.firewall!.policyDenied).toBeGreaterThan(0);
  expect(capacity.terminal!.traffic!.wholeRun).toEqual(before.terminal!.traffic!.wholeRun);
  expect(capacity.terminal!.resources.find(r => r.id === "fw")!.security).toEqual(before.terminal!.resources.find(r => r.id === "fw")!.security);
  expect(policy.challenge!.criteria.filter(c => c.status !== "met").map(c => c.id)).toEqual(["work"]);
  expect(policy.terminal!.resources.find(r => r.id === "app")!.cpu).toBe(100);
  expect(policy.terminal!.traffic!.wholeRun!.completed).toBeGreaterThan(1900);
  expect(policy.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(50);
  expect(policy.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(500);
  for (const r of [combined, extra]) {
    expect(r.terminal!.traffic!.wholeRun!.completed).toBeGreaterThan(2300); expect(r.terminal!.traffic!.wholeRun!.failed).toBe(0);
    expect(r.terminal!.traffic!.wholeRun!.deadlineExceeded).toBe(0); expect(r.terminal!.traffic!.wholeRun!.abandoned).toBe(0);
    expect(r.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10); expect(r.terminal!.health).toBe("healthy");
    expect(r.terminal!.resources.find(r => r.id === "fw")!.security!.firewall).toMatchObject({policyDenied: 0, "flow-capacity": 0});
  }
  expect(extra.terminal!.resources.find(r => r.id === "app")!.cpu!).toBeLessThan(combined.terminal!.resources.find(r => r.id === "app")!.cpu!);
  expect(extra.terminal!.traffic!.wholeRun).toEqual(combined.terminal!.traffic!.wholeRun);
  console.info("la16 designs", JSON.stringify(reports.map((r, i) => ({design: ["starter", "policy-only", "capacity-only", "combined", "extra-headroom"][i],
    cost: r.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd, p95: r.terminal!.traffic!.latencyMs.p95, health: r.terminal!.health,
    whole: r.terminal!.traffic!.wholeRun, appCpu: r.terminal!.resources.find(r => r.id === "app")!.cpu,
    firewall: r.terminal!.resources.find(r => r.id === "fw")!.security!.firewall, verdict: r.challenge!.status}))));
}, 30000);

test("mission ladder: missing, stale or malformed evidence and removed firewall cannot earn a pass", () => {
  const row = attemptRow(d, reference, prediction);
  expect(buildRunReport(row).challenge!.status).toBe("met");
  for (const mutate of [
    (r: typeof row) => { r.terminalSnapshot = null; },
    (r: typeof row) => { raw(r).simulatedSeconds--; },
    (r: typeof row) => { raw(r).metricsTopologyRevision++; },
    (r: typeof row) => { r.runInputs = null; r.liveTopology = null; },
  ]) {
    const bad = structuredClone(row); mutate(bad); const report = buildRunReport(bad);
    expect(report.challenge!.status).not.toBe("met"); expect(status(report, "admission")).toBe("not-evaluated"); expect(status(report, "work")).toBe("not-evaluated");
  }
  for (const mutate of [
    (r: typeof row) => { delete raw(r).metrics!.fw!.security; },
    (r: typeof row) => { delete raw(r).metrics!.fw!.security!.firewall!.policyDenied; },
    (r: typeof row) => { raw(r).metrics!.fw!.security!.firewall!.admissions = -1; },
    (r: typeof row) => { const input = r.runInputs as {resources: Array<{id: string}>}; input.resources = input.resources.filter(x => x.id !== "fw"); },
  ]) { const bad = structuredClone(row); mutate(bad); expect(status(buildRunReport(bad), "admission")).toBe("not-evaluated"); }
  for (const mutate of [
    (r: typeof row) => { delete raw(r).traffic!.wholeRun; },
    (r: typeof row) => { raw(r).traffic!.wholeRun!.throughSecond--; },
    (r: typeof row) => { raw(r).traffic!.wholeRun!.completed = -1; },
    (r: typeof row) => { raw(r).traffic!.wholeRun!.failed = Number.MAX_SAFE_INTEGER + 1; },
  ]) { const bad = structuredClone(row); mutate(bad); expect(status(buildRunReport(bad), "work")).toBe("not-evaluated"); }
  const noGates = structuredClone(row); noGates.stages = [];
  expect(status(buildRunReport(noGates), "checks")).toBe("not-evaluated");
  const badHash = structuredClone(row); badHash.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(badHash).challenge!.status).toBe("unavailable");
}, 30000);
