import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ChallengeDefinition, ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { buildRunReport } from "../reports/report";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRegistry, challengeSeed, specHash } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { validateChallengeVersions } from "../challenges/validate";
import { readPrediction } from "../challenges/prediction";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

const ids = ["diagnose-lost-app-capacity", "investigate-a-pool-reset", "budget-for-a-partition", "trace-a-saturation-cascade"];
const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
const metric = (r: ReturnType<typeof buildRunReport>, id: string) => r.terminal!.resources.find(r => r.id === id)!;
const snapshot = (r: ReturnType<typeof attemptRow>) => r.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};
const prediction = (d: ChallengeDefinition) => answers(d, {"database-admission": "other-or-mixed", "overall-health": "healthy", "database-health": "healthy", "busiest-type": "Virtual Machine"});
const leaves = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a && b && typeof a === "object" && typeof b === "object") return [...new Set([...Object.keys(a), ...Object.keys(b)])].reduce((n, k) => n + leaves((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]), 0);
  return 1;
};

for (const id of ids) test(`${id}: controlled one-setting engine runs, near miss and retained evidence refusal`, () => {
  const d = definition(id), start = d.starter!, fixed = REFERENCE[id]!, near = structuredClone(start);
  // Read the real published pin without importing the older engine calibration suite.
  const published = readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8");
  const hash = new RegExp(`"${id}@1": "([a-f0-9]{64})"`).exec(published)?.[1];
  expect(hash).toBe(specHash(d));
  expect(validateChallengeVersions([d], {[`${id}@1`]: hash!})).toEqual([]);
  if (id === ids[0]) resource(near, "app").size = "large";
  else if (id === ids[1]) resource(near, "lb").retry!.maxAttempts = 5;
  else resource(near, "app").skuId = "m5.2xlarge";
  expect(leaves(start, fixed)).toBe(1); expect(leaves(start, near)).toBe(1);
  const captured = captureRunInputs(start, d.workload, challengeSeed(d));
  for (const s of [start, fixed, near]) {
    expect(preflight(d, s).valid).toBe(true);
    const input = captureRunInputs(s, d.workload, challengeSeed(d));
    expect(input.workloadProfile).toEqual(captured.workloadProfile); expect(input.seed).toBe(captured.seed);
    expect(input.catalogSnapshot).toBe(captured.catalogSnapshot); expect(input.adapterProfiles).toEqual(captured.adapterProfiles);
  }
  const rows = [start, fixed, near].map(s => attemptRow(d, s, prediction(d)));
  const reports = rows.map(row => buildRunReport(row));
  const [before, after, wrong] = reports as [typeof reports[number], typeof reports[number], typeof reports[number]];
  expect(before.challenge!.status).toBe("not-met"); expect(after.challenge!.status).toBe("met"); expect(wrong.challenge!.status).toBe("not-met");
  for (const [i, report] of reports.entries()) {
    expect(report.terminal!.simulatedSeconds).toBe(d.evaluationSeconds);
    expect(report.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
    const saved = {...rows[i]!, terminalSnapshot: JSON.parse(JSON.stringify(rows[i]!.terminalSnapshot)), runInputs: JSON.parse(JSON.stringify(rows[i]!.runInputs)), actions: structuredClone(rows[i]!.actions)};
    expect(buildRunReport(saved).challenge).toEqual(report.challenge);
    expect(buildRunReport(saved).terminal).toEqual(report.terminal);
  }
  if (id === ids[0]) {
    expect(metric(before, "app").cpu).toBe(100); expect(metric(before, "peer").rps).toBe(0); expect(metric(before, "db").health).toBe("healthy");
    expect(metric(before, "fw").security!.firewall).toMatchObject({admissions: 1, "flow-capacity": 1, policyDenied: 0});
    expect(metric(after, "fw").security!.firewall).toMatchObject({admissions: 2, "flow-capacity": 0, policyDenied: 0});
    expect(metric(after, "app").cpu!).toBeLessThan(80); expect(metric(after, "peer").rps!).toBeGreaterThan(200);
    expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(800); expect(after.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10);
    expect(before.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(500); expect(after.terminal!.traffic!.wholeRun!.failed).toBe(0);
    // Treating the loud symptom can improve current latency without admitting the refused path.
    expect(wrong.challenge!.criteria.find(c => c.id === "admission")!.status).toBe("not-met");
    expect(metric(wrong, "fw").security!.firewall!["flow-capacity"]).toBeGreaterThan(0);
    expect(before.challenge!.predictions[0]!.actual).toBe("other-or-mixed"); expect(after.challenge!.predictions[0]!.actual).toBe("no-denials");

    const guessed = prediction(d); guessed.answers.cause = "no-listener";
    const observed = buildRunReport(attemptRow(d, start, guessed));
    expect(observed.challenge!.predictions[0]).toMatchObject({actual: "other-or-mixed", outcome: "different"});
    const chosen = readPrediction({answers: {...guessed.answers, cause: observed.challenge!.predictions[0]!.actual!}, reasoning: "DB paths are present, policy and missing-listener denials are zero; fw records a capacity refusal while peer serves no callers."}, d, start.resources.map(r => r.type));
    const diagnosedRow = attemptRow(d, start, chosen), diagnosed = buildRunReport(diagnosedRow);
    expect(diagnosedRow.runInputs).toEqual(rows[0]!.runInputs); expect(start).toEqual(d.starter!);
    expect(diagnosed.challenge!.status).toBe("not-met"); expect(diagnosed.challenge!.predictions[0]).toMatchObject({actual: "other-or-mixed", outcome: "matched"});
    expect(() => readPrediction({answers: {...chosen.answers, cause: "flow-capacity"}}, d, start.resources.map(r => r.type))).toThrow();
    expect(() => readPrediction({answers: {busy: "Virtual Machine"}}, d, start.resources.map(r => r.type))).toThrow();
    for (const corrupt of [
      (r: typeof diagnosedRow) => { delete snapshot(r).metrics.db!.security; },
      (r: typeof diagnosedRow) => { snapshot(r).metrics.db!.security!.edges.pop(); },
      (r: typeof diagnosedRow) => { snapshot(r).metrics.db!.security!.edges[0]!.policyDenied = null; },
      (r: typeof diagnosedRow) => { snapshot(r).metrics.db!.security!.edges.push(snapshot(r).metrics.db!.security!.edges[0]!); },
    ]) {
      const bad = structuredClone(diagnosedRow); corrupt(bad);
      expect(buildRunReport(bad).challenge!.predictions[0]).toMatchObject({outcome: "unknown", actual: null});
    }
    for (const corrupt of [
      (r: typeof diagnosedRow) => { delete snapshot(r).metrics.fw!.security; },
      (r: typeof diagnosedRow) => { snapshot(r).metrics.fw!.security!.firewall!["flow-capacity"] = null; },
    ]) {
      const bad = structuredClone(rows[1]!); corrupt(bad);
      expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "admission")!.status).toBe("not-evaluated");
    }
  } else if (id === ids[1]) {
    expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(2600);
    expect(after.terminal!.traffic!.latencyMs.p95!).toBeLessThan(2000); expect(after.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(1000);
    expect(wrong.terminal!.traffic!.latencyMs.p95!).toBeGreaterThanOrEqual(before.terminal!.traffic!.latencyMs.p95!);
    // A passing tail still has failures. Compare populations, rather than inventing recovery.
    expect(after.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(200);
    expect(after.terminal!.traffic!.wholeRun!.completed).toBe(before.terminal!.traffic!.wholeRun!.completed);
    for (const report of reports) {
      expect(report.actions.map(a => [a.scenarioStepId, a.appliedSimulatedSeconds, a.completedSimulatedSeconds])).toEqual([["db-slowdown", 2, 6], ["reset-pool", 3, 4]]);
      const [slow, reset] = report.actions;
      expect(slow!.outcome!.intervention).toMatchObject({atUs: 2000001, endUs: 5000001, resolvedTargets: ["db"]});
      expect(reset!.outcome!.intervention).toMatchObject({atUs: 3000001, endUs: null, resolvedTargets: ["app-db:app:db"]});
      expect(reset!.outcome!.interventionEnded).toBe(true);
      expect(report.experimentTrace).toMatchObject({status: "not-applicable", sampleCount: 0, points: []});
      expect(report.unknown.join(" ")).toContain("continuous telemetry");
      expect(metric(report, "db").health).toBe("healthy");
    }
  } else if (id === ids[2]) {
    expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(150); expect(after.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10);
    expect(before.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(200); expect(after.terminal!.traffic!.wholeRun!.failed).toBe(0);
    const alternative = buildRunReport(attemptRow(d, REFERENCE[`${id}-headroom`]!, prediction(d)));
    expect(alternative.challenge!.status).toBe("met");
    const cost = (r: typeof after) => r.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd!;
    expect(cost(after)).toBeLessThan(cost(alternative)); expect(cost(alternative)).toBeLessThanOrEqual(200);
    expect(metric(alternative, "peer").cpu!).toBeLessThan(metric(after, "peer").cpu! / 1.8);
    expect(alternative.terminal!.traffic!.wholeRun).toEqual(after.terminal!.traffic!.wholeRun);
    console.info(JSON.stringify({lab: id, validDesigns: [after, alternative].map(r => ({cost: cost(r), peerCpu: metric(r, "peer").cpu, p95: r.terminal!.traffic!.latencyMs.p95, wholeRun: r.terminal!.traffic!.wholeRun}))}));
  } else {
    expect(metric(before, "db").cpu).toBe(100); expect(metric(before, "db").database!.waiting).toBeGreaterThan(0);
    expect(metric(after, "db").cpu!).toBeLessThan(70); expect(metric(after, "db").database!.waiting).toBe(0);
    expect(before.terminal!.traffic!.latency!.typical!.categories.connectionWait!.meanMs).toBeGreaterThan(300);
    expect(after.terminal!.traffic!.latency!.typical!.categories.connectionWait!.meanMs).toBe(0);
    expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(400); expect(after.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10);
    expect(metric(after, "app").cpu!).toBeGreaterThan(metric(before, "app").cpu!);
    for (const report of reports) expect(metric(report, "db").database!.sessionRefused).toBe(0);
    expect(after.terminal!.traffic!.wholeRun!.completed).toBeGreaterThan(before.terminal!.traffic!.wholeRun!.completed);
    expect(before.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(400); expect(after.terminal!.traffic!.wholeRun!.failed).toBe(0);
    expect(after.terminal!.health).toBe("degraded");
    expect(metric(before, "lb").lbAccounting!.queuedAtVm).toBe(0); // Do not invent VM admission-queue pressure.
  }

  if (d.scenario) {
    const {scenario: _scenario, ...control} = d;
    const noFault = buildRunReport(attemptRow(control, start, prediction(control)), buildRegistry([control]));
    expect(noFault.terminal!.traffic!.wholeRun!.failed).toBe(0); expect(noFault.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10);
    for (const [i] of d.scenario.steps.entries()) for (const corrupt of [
      (r: typeof rows[number]) => { r.actions!.splice(i, 1); },
      (r: typeof rows[number]) => { r.actions![i]!.appliedSimulatedSeconds!++; },
      (r: typeof rows[number]) => { r.actions![i]!.completedSimulatedSeconds!++; },
      (r: typeof rows[number]) => { r.actions![i]!.completedAt = null; },
      (r: typeof rows[number]) => { (r.actions![i]!.outcome as {interventionEnded: boolean}).interventionEnded = false; },
      (r: typeof rows[number]) => { (r.actions![i]!.outcome as {intervention: {resolvedTargets: string[]}}).intervention.resolvedTargets = ["invented"]; },
    ]) {
      const bad = structuredClone(rows[1]!); corrupt(bad);
      const report = buildRunReport(bad);
      expect(report.challenge!.status).toBe("not-evaluated"); expect(report.challenge!.criteria.every(c => c.status === "not-evaluated")).toBe(true);
      expect(report.challenge!.predictions.every(p => p.actual === null && p.outcome === "unknown")).toBe(true);
    }
    const absent = buildRunReport(attemptRow(d, fixed, prediction(d), {skipExperiment: true}));
    expect(absent.challenge!.status).toBe("not-evaluated");
    const unbound = structuredClone(fixed); unbound.connectionLines = unbound.connectionLines.filter(l => l.id !== (id === ids[1] ? "app-db" : "lb-app"));
    expect(preflight(d, unbound).valid).toBe(false);
  }
  for (const corrupt of [
    (r: typeof rows[number]) => { r.terminalSnapshot = null; },
    (r: typeof rows[number]) => { snapshot(r).simulatedSeconds--; },
    (r: typeof rows[number]) => { snapshot(r).metricsTopologyRevision++; },
    (r: typeof rows[number]) => { snapshot(r).traffic = undefined; },
    (r: typeof rows[number]) => { snapshot(r).traffic!.latencyMs.p95 = null; },
    (r: typeof rows[number]) => { snapshot(r).traffic!.completedRps = 0; },
  ]) {
    const bad = structuredClone(rows[1]!); corrupt(bad);
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "latency")!.status).toBe("not-evaluated");
    expect(buildRunReport(bad).challenge!.status).not.toBe("met");
  }
  const mismatch = structuredClone(rows[1]!); mismatch.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(mismatch).challenge!.status).toBe("unavailable");
  const noInput = structuredClone(rows[1]!); noInput.runInputs = null; noInput.liveTopology = null;
  expect(buildRunReport(noInput).challenge!.status).not.toBe("met");
  const noChecks = structuredClone(rows[1]!); noChecks.stages = [];
  expect(buildRunReport(noChecks).challenge!.criteria.find(c => c.id === "checks")!.status).toBe("not-evaluated");
  expect(buildRunReport(noChecks).challenge!.status).not.toBe("met");
  console.info(JSON.stringify({lab: id, variants: reports.map((r, i) => ({variant: ["starter", "reference", "near-miss"][i], health: r.terminal!.health, p95: r.terminal!.traffic!.latencyMs.p95,
    wholeRun: r.terminal!.traffic!.wholeRun, connectionWait: r.terminal!.traffic!.latency?.typical?.categories.connectionWait, resources: r.terminal!.resources,
    criteria: r.challenge!.criteria, predictions: r.challenge!.predictions}))}));
}, 120000);
