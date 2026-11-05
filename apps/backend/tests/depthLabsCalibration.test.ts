import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { buildRunReport } from "../reports/report";
import { captureRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { isDepthCriterion, evaluateDepthCriterion } from "../challenges/depthCriteria";
import { validateChallengeVersions } from "../challenges/validate";
import { specHash } from "../challenges/registry";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

const ids = ["protect-one-api-route", "queue-overlapping-jobs", "bound-function-pool-pressure"];
const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
const metric = (r: ReturnType<typeof buildRunReport>, id: string) => r.terminal!.resources.find(r => r.id === id)!;
const snapshot = (r: ReturnType<typeof attemptRow>) => r.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};
const leaves = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a && b && typeof a === "object" && typeof b === "object") return [...new Set([...Object.keys(a), ...Object.keys(b)])].reduce((n, k) => n + leaves((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]), 0);
  return 1;
};

for (const id of ids) test(`${id}: one-setting causal runs, near miss, retained reports and missing-evidence refusal`, () => {
  const d = definition(id), start = d.starter!, fixed = REFERENCE[id]!, near = structuredClone(start);
  if (id === ids[0]) resource(near, "gateway").apiGateway!.routes![1]!.burstRequests = 1; // Wrong route's budget.
  else if (id === ids[1]) resource(near, "timer").scheduler!.overlap = "skip";
  else resource(near, "fn").serverless!.concurrency = 1;
  expect(leaves(start, fixed)).toBe(1); expect(leaves(start, near)).toBe(1);
  for (const s of [start, fixed, near]) {
    expect(preflight(d, s).valid).toBe(true);
    expect(captureRunInputs(s, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile);
  }
  const prediction = answers(d, {"overall-health": "healthy", "database-health": "healthy"});
  const rows = [start, fixed, near].map(s => attemptRow(d, s, prediction));
  const reports = rows.map(r => buildRunReport(r));
  const [before, after, wrong] = reports as [typeof reports[number], typeof reports[number], typeof reports[number]];
  expect(before.challenge!.status).toBe("not-met"); expect(wrong.challenge!.status).toBe("not-met");
  expect(after.challenge!.status).toBe("met"); expect(after.challenge!.criteria.every(c => c.status === "met")).toBe(true);
  for (const [i, r] of reports.entries()) {
    expect(r.terminal!.simulatedSeconds).toBe(d.evaluationSeconds);
    expect(r.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
    for (const m of r.terminal!.resources) for (const key of ["gateway", "scheduler", "serverless"] as const) if (m[key]) expect(m[key]).toEqual(snapshot(rows[i]!).metrics[m.id]![key]!);
    // Saving and loading the actual captured row retains the generic server result.
    const loaded = {...rows[i]!, terminalSnapshot: JSON.parse(JSON.stringify(rows[i]!.terminalSnapshot)), runInputs: JSON.parse(JSON.stringify(rows[i]!.runInputs))};
    expect(buildRunReport(loaded).challenge).toEqual(r.challenge);
  }
  if (id === ids[0]) {
    const a = metric(before, "gateway").gateway!, b = metric(after, "gateway").gateway!;
    expect(a.routes[0]!.outcomes!.upstreamFailed).toBeGreaterThan(1000);
    expect(b.routes[0]).toMatchObject({admitted: 2, rejected: 1998, outcomes: {completed: 2, upstreamFailed: 0}});
    expect(b.routes[1]).toMatchObject({admitted: a.routes[1]!.admitted, rejected: a.routes[1]!.rejected, outcomes: {completed: a.routes[1]!.outcomes!.completed, upstreamFailed: 0}});
    expect(b.routes[1]!.outcomes!.completed).toBeGreaterThan(250);
    expect(metric(before, "readApp").cpu).toBe(100); expect(metric(after, "readApp").cpu!).toBeLessThan(1);
    expect(after.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(before.terminal!.traffic!.wholeRun!.failed);
    expect(after.terminal!.health).not.toBe("healthy");
  } else if (id === ids[1]) {
    const a = metric(before, "timer").scheduler!, b = metric(after, "timer").scheduler!;
    expect(a).toMatchObject({due: 20, completed: 15, failed: 5, missed: 5});
    expect(b).toMatchObject({due: 20, completed: 20, missed: 0, active: 0, queued: 0, peakActive: 1, peakQueued: 13});
    expect(b.attemptAccounting!.delayedStarts).toBe(19); expect(b.attemptAccounting!.maxStartDelayUs).toBeGreaterThan(1200000);
    expect(metric(before, "fn").serverless!.throttled).toBe(5); expect(metric(after, "fn").serverless!.throttled).toBe(0);
    expect(metric(after, "fn").serverless!.downstreamCalls).toBe(24);
    expect(metric(wrong, "timer").scheduler).toMatchObject({completed: 5, missed: 15, skippedOverlap: 15});
    expect(before.terminal!.health).toBe("healthy");
    expect(after.terminal!.traffic!.wholeRun!.completed).toBe(4); // Scheduled jobs are not foreground callers.
  } else {
    const a = metric(before, "fn").serverless!, b = metric(after, "fn").serverless!;
    expect(a.coldStarts).toBe(128); expect(b.coldStarts).toBe(32);
    expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(125);
    expect(after.terminal!.traffic!.latencyMs.p95!).toBeLessThan(105);
    expect(metric(before, "db").cpu).toBe(100); expect(metric(after, "db").cpu!).toBeLessThan(35);
    expect(metric(before, "db").connections).toBe(10);
    expect(before.terminal!.traffic!.latency!.typical!.categories.connectionWait!.meanMs).toBeGreaterThan(15);
    expect(after.terminal!.traffic!.latency!.typical!.categories.connectionWait!.meanMs).toBe(0);
    expect(metric(before, "db").database!.sessionRefused).toBe(0); expect(metric(after, "db").database!.sessionRefused).toBe(0);
    expect(b.throttled).toBeGreaterThan(a.throttled); expect(b.completed).toBeLessThan(a.completed);
    expect(wrong.challenge!.criteria.find(c => c.id === "work")!.status).toBe("not-met");
    expect(wrong.challenge!.criteria.find(c => c.id === "latency")!.status).toBe("met");
  }
  console.info(JSON.stringify({lab: id, variants: reports.map((r, i) => ({variant: ["starter", "reference", "near-miss"][i], health: r.terminal!.health, p95: r.terminal!.traffic!.latencyMs.p95, wholeRun: r.terminal!.traffic!.wholeRun,
    connectionWait: r.terminal!.traffic!.latency?.typical?.categories.connectionWait,
    resources: r.terminal!.resources, requirements: r.challenge!.criteria}))}));

  const row = rows[1]!, work = d.criteria.find(c => ["gateway-route-work", "scheduler-work", "function-work"].includes(c.kind))!;
  const workStatus = (r: typeof row) => buildRunReport(r).challenge!.criteria.find(c => c.id === work.id)!.status;
  if (!isDepthCriterion(work)) throw Error("Expected resource counter criterion");
  for (const corrupt of [
    (t: NonNullable<typeof after.terminal>) => { t.resources.push(structuredClone(t.resources.find(r => r.id === work.resourceId)!)); },
    (t: NonNullable<typeof after.terminal>) => { t.measurementFreshness = "unknown"; },
    (t: NonNullable<typeof after.terminal>) => {
      const m = t.resources.find(r => r.id === work.resourceId)!;
      if (work.kind === "gateway-route-work") m.gateway!.routes[0]!.target = "writeApp";
      else if (work.kind === "scheduler-work") m.scheduler!.due++;
      else m.serverless!.admitted++;
    },
  ]) {
    const t = structuredClone(after.terminal!); corrupt(t);
    expect(evaluateDepthCriterion(work, fixed, t).met).toBeUndefined();
  }
  expect(evaluateDepthCriterion(work, {...fixed, resources: fixed.resources.filter(r => r.id !== work.resourceId)}, after.terminal!).met).toBeUndefined();
  if (work.kind === "function-work") expect(evaluateDepthCriterion(work, {...fixed, connectionLines: []}, after.terminal!).met).toBeUndefined();
  for (const minCompleted of [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = {...d, criteria: [{...work, minCompleted}]};
    expect(validateChallengeVersions([bad], {[`${d.id}@1`]: specHash(bad)}).some(p => p.includes(work.kind))).toBe(true);
  }
  const target = id === ids[0] ? "gateway" : id === ids[1] ? "timer" : "fn";
  const key = id === ids[0] ? "gateway" : id === ids[1] ? "scheduler" : "serverless";
  for (const mutate of [
    (r: typeof row) => { r.terminalSnapshot = null; },
    (r: typeof row) => { snapshot(r).simulatedSeconds--; },
    (r: typeof row) => { snapshot(r).metricsTopologyRevision++; },
    (r: typeof row) => { delete snapshot(r).metrics[target]; },
    (r: typeof row) => { delete snapshot(r).metrics[target]![key]; },
    (r: typeof row) => { snapshot(r).metrics[target]![key]!.completed = -1; },
    (r: typeof row) => { snapshot(r).metrics[target]![key]!.completed = Number.MAX_SAFE_INTEGER + 1; },
  ]) {
    const missing = structuredClone(row); mutate(missing);
    expect(workStatus(missing)).toBe("not-evaluated"); expect(buildRunReport(missing).challenge!.status).not.toBe("met");
  }
  const missingDetail = structuredClone(row);
  if (key === "gateway") delete snapshot(missingDetail).metrics[target]!.gateway!.routes[0]!.outcomes;
  else if (key === "scheduler") delete snapshot(missingDetail).metrics[target]!.scheduler!.attemptAccounting;
  else delete snapshot(missingDetail).metrics[target]!.serverless!.lifecycle;
  expect(workStatus(missingDetail)).toBe("not-evaluated");
  const mismatch = structuredClone(row); mismatch.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(mismatch).challenge!.status).toBe("unavailable");
  const active = structuredClone(row); active.status = "running"; active.runtimeActive = true; active.terminalSnapshot = null;
  expect(workStatus(active)).toBe("pending");
  const invalid = structuredClone(start);
  if (id === ids[0]) resource(invalid, target).apiGateway!.routes![0]!.burstRequests = 0;
  else if (id === ids[1]) resource(invalid, target).scheduler!.queueCapacity = -1;
  else resource(invalid, target).serverless!.concurrency = 0;
  expect(preflight(d, invalid).valid).toBe(false);
}, 120000);
