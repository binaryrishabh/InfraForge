import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { buildRunReport } from "../reports/report";
import { captureRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

const ids = ["catalogue-link-flash", "flash-sale-order-backlog"];
const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
const metric = (r: ReturnType<typeof buildRunReport>, id: string) => r.terminal!.resources.find(r => r.id === id)!;
const snapshot = (r: ReturnType<typeof attemptRow>) => r.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};

for (const id of ids) test(`${id}: both earlier ideas are necessary; each controlled one-setting comparison has real evidence`, () => {
  const d = definition(id), start = d.starter!, fixed = REFERENCE[id]!, first = structuredClone(fixed), second = structuredClone(fixed);
  if (id === ids[0]) {
    resource(first, "cache").cachePolicy = structuredClone(resource(start, "cache").cachePolicy);
    delete resource(second, "app").skuId;
  } else {
    resource(first, "queue").asyncQueue!.visibilityTimeoutSeconds = 1;
    resource(second, "worker").asyncWorker!.cpuMsPerJob = 250;
  }
  // Each partial differs from the passing reference by exactly one saved setting.
  // Combining the two reversals restores the entire starter, including all edges.
  const restored = structuredClone(first);
  if (id === ids[0]) delete resource(restored, "app").skuId;
  else resource(restored, "worker").asyncWorker!.cpuMsPerJob = 250;
  expect(restored).toEqual(start);
  const differingLeaves = (a: unknown, b: unknown): number => {
    if (a === b) return 0;
    if (a && b && typeof a === "object" && typeof b === "object") return [...new Set([...Object.keys(a), ...Object.keys(b)])].reduce((n, k) => n + differingLeaves((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]), 0);
    return 1;
  };
  expect(differingLeaves(first, fixed)).toBe(1); expect(differingLeaves(second, fixed)).toBe(1);
  expect(differingLeaves(start, first)).toBe(1); expect(differingLeaves(start, second)).toBe(1);
  for (const design of [start, first, second, fixed]) {
    expect(preflight(d, design).valid).toBe(true);
    expect(captureRunInputs(design, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile);
  }
  const prediction = answers(d, {"overall-health": "healthy"});
  const rows = [start, first, second, fixed].map(s => attemptRow(d, s, prediction));
  const reports = rows.map(r => buildRunReport(r));
  const [before, onlyFirst, onlySecond, after] = reports as [typeof reports[number], typeof reports[number], typeof reports[number], typeof reports[number]];
  for (const r of [before, onlyFirst, onlySecond]) expect(r.challenge!.status).toBe("not-met");
  expect(after.challenge!.status).toBe("met"); expect(after.challenge!.criteria.every(c => c.status === "met")).toBe(true);
  for (const r of reports) {
    expect(r.terminal!.simulatedSeconds).toBe(d.evaluationSeconds);
    expect(r.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
  }
  if (id === ids[0]) {
    expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(800);
    expect(onlyFirst.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(5);
    expect(metric(onlyFirst, "db").cpu!).toBeGreaterThan(10);
    expect(metric(onlySecond, "app").health).toBe("saturated");
    expect(after.terminal!.traffic!.latencyMs.p95!).toBeLessThan(4.1);
    expect(after.terminal!.traffic!.completedRps).toBe(800);
    expect(metric(after, "app").cpu).toBe(60);
    expect(metric(after, "db").cpu).toBeLessThan(metric(onlyFirst, "db").cpu!);
    // Last-second latency omits other caller outcomes; those populations remain visible.
    expect(before.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(0);
    expect(after.terminal!.traffic!.wholeRun!.failed).toBe(0);
  } else {
    const q = (r: typeof before) => metric(r, "queue").queueWork!;
    expect(q(before).acknowledged).toBe(0); expect(q(onlyFirst).redeliveries).toBeGreaterThan(0);
    expect(q(onlySecond).acknowledged).toBeLessThan(900);
    expect(q(after)).toMatchObject({originals: 920, acknowledged: 914, ready: 0, inFlight: 6, scheduled: 0, redeliveries: 0, deadLettered: 0, discarded: 0, expired: 0});
    for (const r of reports) {
      expect(metric(r, "app").health).toBe("healthy");
      expect(r.terminal!.traffic).toEqual(after.terminal!.traffic);
    }
    const peak = buildRunReport(attemptRow(d, fixed, prediction, {stopAt: 140}));
    expect(q(peak)).toMatchObject({originals: 800, ready: 110, inFlight: 32, acknowledged: 658, redeliveries: 0});
    expect(q(after).ready + q(after).inFlight).toBeLessThan(q(peak).ready + q(peak).inFlight);
    expect(q(after).originals).toBeGreaterThan(q(peak).originals); // Drain despite continuing arrivals.
    expect(peak.challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
    console.info(JSON.stringify({mission: id, measuredAt140: q(peak), measuredAt170: q(after)}));
  }
  console.info(JSON.stringify({mission: id, variants: reports.map((r, i) => ({variant: ["starter", "first-only", "second-only", "combined"][i], health: r.terminal!.health,
    p95: r.terminal!.traffic!.latencyMs.p95, completedRps: r.terminal!.traffic!.completedRps, wholeRun: r.terminal!.traffic!.wholeRun,
    appCpu: metric(r, "app").cpu, dbCpu: r.terminal!.resources.find(r => r.id === "db")?.cpu, queue: r.terminal!.resources.find(r => r.id === "queue")?.queueWork}))}));

  const row = rows[3]!;
  for (const mutate of [
    (r: typeof row) => { r.terminalSnapshot = null; },
    (r: typeof row) => { snapshot(r).simulatedSeconds--; },
    (r: typeof row) => { snapshot(r).metricsTopologyRevision++; },
    (r: typeof row) => { delete snapshot(r).traffic; },
    (r: typeof row) => { snapshot(r).traffic!.latencyMs.p95 = null; },
    (r: typeof row) => { snapshot(r).traffic!.completedRps = 0; },
  ]) {
    const missing = structuredClone(row); mutate(missing);
    expect(buildRunReport(missing).challenge!.criteria.find(c => c.id === "latency")!.status).toBe("not-evaluated");
    expect(buildRunReport(missing).challenge!.status).not.toBe("met");
  }
  if (id === ids[1]) for (const mutate of [
    (r: typeof row) => { delete snapshot(r).metrics.queue!.queueWork; },
    (r: typeof row) => { snapshot(r).metrics.queue!.queueWork!.throughSecond--; },
    (r: typeof row) => { snapshot(r).metrics.queue!.queueWork!.acknowledged = -1; },
    (r: typeof row) => { delete snapshot(r).metrics.queue; },
  ]) {
    const missing = structuredClone(row); mutate(missing);
    expect(buildRunReport(missing).challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-evaluated");
  }
  const missing = structuredClone(row); missing.terminalSnapshot = null;
  expect(buildRunReport(missing).challenge!.predictions[0]!.actual).toBeNull();
  const mismatch = structuredClone(row); mismatch.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(mismatch).challenge!.status).toBe("unavailable");
  const running = structuredClone(row); running.status = "running"; running.runtimeActive = true; running.terminalSnapshot = null;
  expect(buildRunReport(running).challenge!.criteria.find(c => c.id === "latency")!.status).toBe("pending");
  const invalid = structuredClone(start);
  if (id === ids[0]) resource(invalid, "cache").cachePolicy = {version: 2, capacityEntries: 0};
  else resource(invalid, "queue").asyncQueue!.visibilityTimeoutSeconds = 0;
  expect(preflight(d, invalid).valid).toBe(false);
}, 600000);
