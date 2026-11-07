import { describe, expect, test } from "bun:test";
import type { ChallengeDefinition, ChallengeStarter } from "@infraforge/contracts/challenges";
import { writesCostMoreThanReadsV1 } from "../challenges/definitions/writes-cost-more-than-reads/v1";
import { balancerSharesTurnsV1 } from "../challenges/definitions/balancer-shares-turns/v1";
import { buildRegistry, challengeSeed } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRunReport } from "../reports/report";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";

const prediction = (d: ChallengeDefinition) => answers(d, {"overall-health": "healthy", "busiest-type": "Virtual Machine"});
const report = (d: ChallengeDefinition, design: ChallengeStarter) => buildRunReport(attemptRow(d, design, prediction(d)));
type Report = ReturnType<typeof report>;
const cpu = (r: Report, id: string) => r.terminal!.resources.find(resource => resource.id === id)!.cpu!;
const p95 = (r: Report) => r.terminal!.traffic!.latencyMs.p95!;
const rps = (r: Report) => r.terminal!.traffic!.completedRps;
const status = (r: Report, id: string) => r.challenge?.criteria.find(c => c.id === id)?.status;
const summary = (r: Report, ids: string[]) => ({p95Ms: p95(r), completedRps: rps(r), health: r.terminal!.health, cpu: Object.fromEntries(ids.map(id => [id, cpu(r, id)]))});

// Every mutation starts from a real passing run, never a hand-authored report.
function refusesBrokenEvidence(passing: Parameters<typeof buildRunReport>[0]) {
  for (const mutate of [
    (row: typeof passing) => { row.terminalSnapshot = null; },
    (row: typeof passing) => { (row.terminalSnapshot as {simulatedSeconds: number}).simulatedSeconds = 11; },
    (row: typeof passing) => { (row.terminalSnapshot as {traffic?: unknown}).traffic = undefined; },
    (row: typeof passing) => { (row.terminalSnapshot as {metricsTopologyRevision: number}).metricsTopologyRevision = 99; },
  ]) {
    const row = structuredClone(passing); mutate(row);
    const broken = buildRunReport(row);
    expect(status(broken, "latency")).toBe("not-evaluated");
  }
  for (const bad of [null, -1, NaN, Infinity]) {
    const row = structuredClone(passing);
    (row.terminalSnapshot as {traffic: {latencyMs: {p95: number | null}}}).traffic.latencyMs.p95 = bad;
    expect(buildRunReport(row).challenge?.criteria.find(c => c.id === "latency")?.status).toBe("not-evaluated");
  }
  const mismatched = structuredClone(passing); mismatched.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(mismatched).challenge?.status).toBe("unavailable");
}

describe("request-path labs: controlled Model 2 evidence", () => {
  test("writes-cost-more-than-reads: one database size fixes the write-heavy mix; a second app does not", () => {
    const d = writesCostMoreThanReadsV1, start = d.starter!, fixed = REFERENCE[d.id]!, secondApp = REFERENCE[`${d.id}-second-app`]!;
    // Undo exactly the one intended setting; every other byte of design stays equal.
    const restored = structuredClone(fixed);
    restored.resources.find(r => r.id === "db")!.size = "small";
    expect(restored).toEqual(start);
    expect(secondApp.resources.filter(r => r.id !== "app2")).toEqual(start.resources);
    expect(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(fixed, d.workload, challengeSeed(d)).workloadProfile);
    for (const design of [start, fixed, secondApp]) expect(preflight(d, design).valid).toBe(true);
    const before = report(d, start), after = report(d, fixed), near = report(d, secondApp);
    // The same unchanged starter handles all reads at the same rate: the mix is the cause.
    const readsOnly = {...d, workload: {...d.workload, readWriteRatio: 1}};
    expect({...readsOnly, workload: d.workload}).toEqual(d);
    expect(challengeSeed(readsOnly)).toBe(challengeSeed(d));
    const control = buildRunReport(attemptRow(readsOnly, start, prediction(readsOnly)), buildRegistry([readsOnly]));
    expect(before.challenge?.status).toBe("not-met");
    expect(status(before, "database")).toBe("not-met");
    expect(status(before, "latency")).toBe("not-met");
    expect(after.challenge?.status).toBe("met");
    expect(near.challenge?.status).toBe("not-met");
    expect(status(near, "database")).toBe("not-met");
    expect(control.challenge?.status).toBe("met");
    expect(before.terminal!.simulatedSeconds).toBe(12);
    expect(p95(before)).toBeGreaterThan(200);
    expect(p95(after)).toBeLessThan(20);
    expect(p95(near)).toBeGreaterThan(200);
    expect(p95(control)).toBeLessThan(20);
    expect(cpu(before, "db")).toBeGreaterThan(99);
    expect(cpu(before, "db")).toBeGreaterThan(cpu(before, "app"));
    expect(before.challenge?.predictions[0]?.actual).toBe("Database");
    expect(cpu(after, "db")).toBeLessThan(cpu(before, "db") * 0.6);
    expect(cpu(control, "db")).toBeLessThan(cpu(before, "db") * 0.7);
    expect(after.terminal!.traffic!.failedRps).toBe(0);
    expect(preflight(d, start).checks.map(c => c.status)).toEqual(["ok", "during-run", "during-run"]);
    console.info(JSON.stringify({lab: d.id, second: 12, before: summary(before, ["app", "db"]), after: summary(after, ["app", "db"]), secondApp: summary(near, ["app", "app2", "db"]),
      readsOnlyControl: summary(control, ["app", "db"])}));
    refusesBrokenEvidence(attemptRow(d, fixed, prediction(d)));
  }, 120000);

  test("writes-cost-more-than-reads: the catalog size a learner picks in the Instance size control also fixes it", () => {
    const d = writesCostMoreThanReadsV1, start = d.starter!, picked = REFERENCE[`${d.id}-catalog`]!;
    // Undo exactly the one control the learner touches; every other byte of design stays equal.
    const restored = structuredClone(picked);
    delete restored.resources.find(r => r.id === "db")!.skuId;
    expect(restored).toEqual(start);
    expect(preflight(d, picked).valid).toBe(true);
    const after = report(d, picked);
    expect(after.challenge?.status).toBe("met");
    expect(after.terminal!.simulatedSeconds).toBe(12);
    expect(p95(after)).toBeLessThan(20);
    expect(after.terminal!.traffic!.failedRps).toBe(0);
    console.info(JSON.stringify({lab: d.id, via: "catalog db.m5.large", second: 12, after: summary(after, ["app", "db"])}));
  }, 120000);

  test("balancer-shares-turns: matching the small server fixes it; enlarging the other does not", () => {
    const d = balancerSharesTurnsV1, start = d.starter!, fixed = REFERENCE[d.id]!, near = REFERENCE[`${d.id}-bigger-b`]!, alt = REFERENCE[`${d.id}-least-outstanding`]!;
    const restored = structuredClone(fixed);
    delete restored.resources.find(r => r.id === "app-a")!.skuId;
    expect(restored).toEqual(start);
    expect(near.resources.filter(r => r.id !== "app-b")).toEqual(start.resources.filter(r => r.id !== "app-b"));
    expect(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(fixed, d.workload, challengeSeed(d)).workloadProfile);
    for (const design of [start, fixed, near, alt]) expect(preflight(d, design).valid).toBe(true);
    const before = report(d, start), after = report(d, fixed), miss = report(d, near), policy = report(d, alt);
    expect(before.challenge?.status).toBe("not-met");
    expect(status(before, "latency")).toBe("not-met");
    expect(status(before, "health")).toBe("not-met");
    expect(after.challenge?.status).toBe("met");
    expect(miss.challenge?.status).toBe("not-met");
    expect(status(miss, "health")).toBe("not-met");
    expect(p95(before)).toBeGreaterThan(300);
    expect(p95(after)).toBeLessThan(20);
    expect(p95(miss)).toBeGreaterThan(300);
    expect(cpu(before, "app-a")).toBeGreaterThan(99);
    expect(cpu(before, "app-b")).toBeLessThan(70);
    expect(cpu(after, "app-a")).toBe(cpu(after, "app-b"));
    expect(cpu(miss, "app-a")).toBeGreaterThan(99);
    expect(cpu(miss, "app-b")).toBeLessThan(cpu(before, "app-b"));
    expect(rps(before)).toBeLessThan(rps(after));
    expect(after.terminal!.traffic!.failedRps).toBe(0);
    expect(before.challenge?.predictions[0]?.actual).toBe("saturated");
    console.info(JSON.stringify({lab: d.id, second: 12, before: summary(before, ["app-a", "app-b"]), after: summary(after, ["app-a", "app-b"]), biggerB: summary(miss, ["app-a", "app-b"]),
      leastOutstanding: {...summary(policy, ["app-a", "app-b"]), status: policy.challenge?.status}}));
    refusesBrokenEvidence(attemptRow(d, fixed, prediction(d)));
  }, 120000);
});
