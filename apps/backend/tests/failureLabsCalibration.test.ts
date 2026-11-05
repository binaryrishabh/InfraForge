import { expect, test } from "bun:test";
import type { ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { buildRunReport } from "../reports/report";
import { SecurityMetricsSchema } from "../reports/securitySchema";
import { buildRegistry, challengeSeed, specHash } from "../challenges/registry";
import { preflight } from "../challenges/preflight";
import { validateChallengeVersions } from "../challenges/validate";
import { readPrediction } from "../challenges/prediction";
import { captureRunInputs } from "../deployments/runInputs";
import { starter } from "../challenges/starter";
import { definition, REFERENCE, attemptRow, answers } from "./challengeHarness";

const ids = ["find-the-denying-rule", "leave-room-for-firewall-flows", "choose-a-retry-mitigation"];
const resource = (s: ChallengeStarter, id: string) => s.resources.find(r => r.id === id)!;
const prediction = (d: ReturnType<typeof definition>) => answers(d, {"database-admission": "policy-denied", "security-clean": "yes", "overall-health": "healthy", "busiest-type": "Virtual Machine"});
const metric = (r: ReturnType<typeof buildRunReport>, id: string) => r.terminal!.resources.find(r => r.id === id)!;
const snapshot = (r: ReturnType<typeof attemptRow>) => r.terminalSnapshot as SimulationSnapshot & {metricsTopologyRevision: number};

for (const id of ids) test(`${id}: one-change real-engine reference passes, plausible wrong mitigation fails`, () => {
  const d = definition(id), start = d.starter!, fixed = REFERENCE[id]!, restored = structuredClone(fixed), near = structuredClone(start);
  if (id === ids[0]) {
    resource(restored, "fw").firewallSettings!.rules[0]!.priority = 0;
    resource(near, "fw").firewallCapacity!.maxFlows = 1000;
  } else if (id === ids[1]) {
    resource(restored, "fw").firewallCapacity!.maxFlows = 1;
    resource(near, "app").skuId = "m5.2xlarge";
  } else {
    resource(restored, "lb").retry!.maxAttempts = 4;
    resource(near, "lb").retry!.maxAttempts = 5;
  }
  expect(restored).toEqual(start);
  expect(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(fixed, d.workload, challengeSeed(d)).workloadProfile);
  for (const design of [start, fixed, near]) expect(preflight(d, design).valid).toBe(true);
  const rows = [start, fixed, near].map(s => attemptRow(d, s, prediction(d)));
  const [before, after, wrong] = rows.map(row => buildRunReport(row)) as [ReturnType<typeof buildRunReport>, ReturnType<typeof buildRunReport>, ReturnType<typeof buildRunReport>];
  expect(before.challenge!.status).toBe("not-met"); expect(after.challenge!.status).toBe("met"); expect(wrong.challenge!.status).toBe("not-met");
  for (const report of [before, after, wrong]) expect(report.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
  const summary = (r: typeof before) => ({health: r.terminal!.health, p95: r.terminal!.traffic!.latencyMs.p95, wholeRun: r.terminal!.traffic!.wholeRun, firewall: r.terminal!.resources.find(r => r.id === "fw")?.security?.firewall,
    appCpu: metric(r, "app").cpu, databaseCpu: metric(r, "db").cpu, lb: metric(r, "lb").lbAccounting});
  console.info(JSON.stringify({lab: id, before: summary(before), after: summary(after), nearMiss: summary(wrong)}));
  if (id === ids[0]) {
    expect(before.challenge!.predictions[0]).toMatchObject({actual: "policy-denied", outcome: "matched"});
    expect(before.challenge!.predictions[0]!.detail).toContain("fw:ingress:quarantine-db");
    expect(after.challenge!.predictions[0]).toMatchObject({actual: "no-denials", outcome: "different"});
    for (const r of [before, after, wrong]) expect(r.challenge!.criteria.find(c => c.id === "scan")!.status).toBe("met");
    expect(metric(before, "db").cpu).toBe(0); expect(metric(before, "db").health).toBe("healthy");
    expect(metric(before, "db").security!.edges[0]).toMatchObject({denied: 2, noListener: 0, backendDeliveries: 0});
    expect(metric(before, "db").security!.edges[0]!.lastDenial!.reason).toBe("policy-denied:fw:ingress:quarantine-db");
    expect(before.terminal!.traffic!.wholeRun).toMatchObject({completed: 0, failed: 32});
    expect(after.terminal!.traffic!.wholeRun).toMatchObject({completed: 32, failed: 0});
    expect(metric(wrong, "fw").security!.firewall!.policyDenied).toBe(2);
  } else if (id === ids[1]) {
    expect(metric(before, "fw").security!.firewall).toMatchObject({occupancy: 1, admissions: 1, "flow-capacity": 3, policyDenied: 0});
    expect(metric(after, "fw").security!.firewall).toMatchObject({occupancy: 4, admissions: 5, "flow-capacity": 0, expired: 1});
    expect(metric(wrong, "fw").security!.firewall!["flow-capacity"]).toBeGreaterThan(0);
    expect(metric(wrong, "app").cpu!).toBeLessThan(metric(before, "app").cpu!);
    expect(before.terminal!.traffic!.wholeRun).toMatchObject({completed: 1200, failed: 0});
    expect(after.terminal!.traffic!.wholeRun).toMatchObject({completed: 1200, failed: 0});
    expect(before.terminal!.health).toBe("healthy"); expect(metric(before, "fw").health).toBe("unknown");
    expect(metric(after, "fw").security!.firewall!.admissions).toBeGreaterThan(metric(after, "fw").security!.firewall!.occupancy);
  } else {
    expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(60);
    expect(after.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10);
    expect(wrong.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(20);
    const lb = (r: typeof before) => metric(r, "lb").lbAccounting!;
    expect(lb(after).acceptedByBackend).toBeLessThan(lb(before).acceptedByBackend);
    expect(lb(wrong).acceptedByBackend).toBeGreaterThan(lb(before).acceptedByBackend);
    expect(lb(after).queuedAtVm).toBeLessThan(lb(before).queuedAtVm);
    expect(after.terminal!.traffic!.wholeRun!.completed).toBeLessThan(before.terminal!.traffic!.wholeRun!.completed);
    expect(after.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(before.terminal!.traffic!.wholeRun!.failed);
    for (const r of [before, after, wrong]) {
      expect(r.actions[0]).toMatchObject({status: "completed", appliedSimulatedSeconds: 2, completedSimulatedSeconds: 5});
      expect(r.actions[0]!.outcome!.interventionEnded).toBe(true);
      expect(r.terminal!.health).toBe("healthy");
    }
    // The identical no-partition control has no queued-at-VM work or caller failures.
    const {scenario: _scenario, ...control} = d;
    const report = buildRunReport(attemptRow(control, start, prediction(control)), buildRegistry([control]));
    expect(report.terminal!.traffic!.wholeRun!.failed).toBe(0); expect(metric(report, "lb").lbAccounting!.queuedAtVm).toBe(0);
    expect(report.terminal!.traffic!.latencyMs.p95!).toBeLessThan(10);
    for (const mutate of [
      (r: typeof rows[number]) => { r.actions = []; },
      (r: typeof rows[number]) => { (r.actions![0]!.outcome as {interventionEnded: boolean}).interventionEnded = false; },
      (r: typeof rows[number]) => { r.actions![0]!.completedSimulatedSeconds = 4; },
      (r: typeof rows[number]) => { snapshot(r).traffic = undefined; },
    ]) {
      const row = structuredClone(rows[1]!); mutate(row);
      expect(buildRunReport(row).challenge!.criteria.find(c => c.id === "latency")!.status).toBe("not-evaluated");
    }
  }
  for (const mutate of [
    (r: typeof rows[number]) => { r.terminalSnapshot = null; },
    (r: typeof rows[number]) => { snapshot(r).simulatedSeconds--; },
    (r: typeof rows[number]) => { snapshot(r).metricsTopologyRevision++; },
  ]) {
    const row = structuredClone(rows[1]!); mutate(row);
    expect(buildRunReport(row).challenge!.criteria.find(c => c.id === (id === ids[2] ? "latency" : "admission"))!.status).toBe("not-evaluated");
  }
  const mismatch = structuredClone(rows[1]!); mismatch.challengeSpecHash = "0".repeat(64);
  expect(buildRunReport(mismatch).challenge!.status).toBe("unavailable");
}, 120000);

test("firewall budget and diagnosis refuse absent, malformed, stale or incomplete evidence; missing is not zero", () => {
  const d = definition(ids[0]!), row = attemptRow(d, REFERENCE[d.id]!, prediction(d));
  for (const mutate of [
    (r: typeof row) => { delete snapshot(r).metrics.fw!.security; },
    (r: typeof row) => { delete snapshot(r).metrics.fw!.security!.firewall; },
    (r: typeof row) => { delete snapshot(r).metrics.fw!.security!.firewall!.policyDenied; },
    (r: typeof row) => { snapshot(r).metrics.fw!.security!.firewall!["flow-capacity"] = null; },
    (r: typeof row) => { (r.runInputs as ChallengeStarter).resources = (r.runInputs as ChallengeStarter).resources.filter(r => r.id !== "fw"); },
  ]) {
    const bad = structuredClone(row); mutate(bad);
    expect(buildRunReport(bad).challenge!.criteria.find(c => c.id === "admission")!.status).toBe("not-evaluated");
  }
  for (const key of ["admissions", "occupancy", "limit", "policyDenied", "flow-capacity", "generation"]) for (const bad of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "missing"]) {
    const copy = structuredClone(row), security = snapshot(copy).metrics.fw!.security!;
    (security.firewall as unknown as Record<string, unknown>)[key] = bad;
    expect(SecurityMetricsSchema.safeParse(security).success).toBe(false);
    expect(buildRunReport(copy).challenge!.criteria.find(c => c.id === "admission")!.status).toBe("not-evaluated");
  }
  for (const mutate of [
    (r: typeof row) => { delete snapshot(r).metrics.db!.security; },
    (r: typeof row) => { snapshot(r).metrics.db!.security!.edges = []; },
    (r: typeof row) => { snapshot(r).metrics.db!.security!.edges[0]!.policyDenied = null; },
    (r: typeof row) => { snapshot(r).metrics.db!.security!.edges[0]!.backendDeliveries = null; },
    (r: typeof row) => { snapshot(r).metrics.db!.security!.edges[0]!.denied = null; },
    (r: typeof row) => { snapshot(r).metrics.db!.security!.edges.push(snapshot(r).metrics.db!.security!.edges[0]!); },
    (r: typeof row) => { snapshot(r).metricsTopologyRevision++; },
    (r: typeof row) => { r.runInputs = null; r.liveTopology = null; },
  ]) {
    const bad = structuredClone(row); mutate(bad);
    expect(buildRunReport(bad).challenge!.predictions[0]!.outcome).toBe("unknown");
  }
  const legacy = structuredClone(row); for (const m of Object.values(snapshot(legacy).metrics)) delete m.security;
  expect(buildRunReport(legacy).terminal).not.toBeNull(); expect(buildRunReport(legacy).challenge!.predictions[0]!.actual).toBeNull();
  const omitted = structuredClone(row); snapshot(omitted).metrics.fw!.security!.evidence = "omitted"; snapshot(omitted).metrics.fw!.security!.omitted = 10;
  // Exact aggregate counters still prove a budget even when connection detail rows were omitted.
  expect(buildRunReport(omitted).challenge!.criteria.find(c => c.id === "admission")!.status).toBe("met");
  const hiddenDetail = attemptRow(d, d.starter!, prediction(d)); snapshot(hiddenDetail).metrics.db!.security!.evidence = "omitted";
  const detailReport = buildRunReport(hiddenDetail);
  expect(metric(detailReport, "db").security!.edges[0]!.lastDenial).toBeUndefined();
  expect(detailReport.challenge!.predictions[0]!.actual).toBe("policy-denied"); // Exact per-rule counters survive detail omission.
  const active = structuredClone(row); active.runtimeActive = true; active.terminalSnapshot = null;
  expect(buildRunReport(active).challenge!.criteria.find(c => c.id === "admission")!.status).toBe("pending");
  const scan = structuredClone(row); (scan.stages as Array<{name: string; details: unknown}>).find(s => s.name === "SecurityScan")!.details = {};
  expect(buildRunReport(scan).challenge!.criteria.find(c => c.id === "scan")!.status).toBe("not-evaluated");
  expect(buildRunReport(scan).challenge!.predictions[1]!.outcome).toBe("unknown");
  expect(() => readPrediction({answers: {cause: "invented", scan: "yes"}}, d, d.starter!.resources.map(r => r.type))).toThrow();
  expect(() => readPrediction({answers: {scan: "yes"}}, d, d.starter!.resources.map(r => r.type))).toThrow();
  expect(readPrediction(prediction(d), d, d.starter!.resources.map(r => r.type))).toEqual(prediction(d));
  for (const patch of [{minAdmissions: 0}, {maxPolicyDenied: -1}, {maxCapacityRefused: 0.5}, {resourceId: "missing"}]) {
    const edited = structuredClone(d); Object.assign(edited.criteria[2]!, patch);
    expect(validateChallengeVersions([edited], {[`${d.id}@1`]: specHash(edited)}).some(p => p.includes("firewall-admission-budget"))).toBe(true);
  }
});

test("learner can diagnose from a retained failing report and verify that choice before editing", () => {
  const d = definition(ids[0]!), start = structuredClone(d.starter!);
  const firstPrediction = prediction(d); firstPrediction.answers.cause = "no-listener";
  const observed = buildRunReport(attemptRow(d, start, firstPrediction));
  expect(observed.challenge!.predictions[0]).toMatchObject({actual: "policy-denied", outcome: "different"});
  const chosen = readPrediction({answers: {cause: observed.challenge!.predictions[0]!.actual!, scan: "yes"}, reasoning: "The recorded quarantine-db rule has denials; DB backend deliveries are zero."}, d, start.resources.map(r => r.type));
  const diagnosed = buildRunReport(attemptRow(d, start, chosen));
  expect(start).toEqual(d.starter!); expect(diagnosed.challenge!.status).toBe("not-met");
  expect(diagnosed.challenge!.predictions[0]).toMatchObject({actual: "policy-denied", outcome: "matched"});
  expect(diagnosed.challenge!.predictions[0]!.detail).toContain("Packet traces and application correctness are not recorded");
});

test("diagnosis distinguishes actual missing listeners, mixed failures and positive delivery without inventing a cause", () => {
  const d = definition(ids[0]!), fixed = structuredClone(REFERENCE[d.id]!);
  resource(fixed, "db").listenerSettings = {version: 1, ports: []};
  const noListener = buildRunReport(attemptRow(d, fixed, prediction(d)));
  expect(noListener.challenge!.predictions[0]!.actual).toBe("no-listener");
  const multiple = starter([["lb", "Load Balancer", 0, 0], ["app", "Virtual Machine", 1, 0], ["app2", "Virtual Machine", 1, 1], ["db", "Database", 2, 0],
    ["fw", "Firewall", 2, 1, {firewallState: {version: 1, idleTimeoutSeconds: 1}, firewallCapacity: {version: 1, maxFlows: 1}, firewallSettings: {version: 1, default: "allow", rules: []}}]],
  [["lb", "app"], ["lb", "app2"], ["app", "db"], ["app2", "db"], ["fw", "db"]]);
  const capacity = buildRunReport(attemptRow(d, multiple, prediction(d)));
  expect(capacity.challenge!.predictions[0]!.actual).toBe("other-or-mixed");
  expect(metric(capacity, "fw").security!.firewall!["flow-capacity"]).toBeGreaterThan(0);
  const missingPath = attemptRow(d, multiple, prediction(d));
  snapshot(missingPath).metrics.db!.security!.edges.pop();
  expect(buildRunReport(missingPath).challenge!.predictions[0]!.outcome).toBe("unknown");
  // A real flow-capacity failure is classified without pretending it was a rule denial.
  const flow = definition(ids[1]!), flowRow = attemptRow(flow, flow.starter!, prediction(flow));
  const invalid = {...flow, predictions: d.predictions};
  const fixedRow = {...flowRow, challengeSpecHash: specHash(invalid), challengePrediction: prediction(invalid)};
  // Replica coverage is deliberately unsupported for this diagnosis kind.
  expect(buildRunReport(fixedRow, buildRegistry([invalid])).challenge!.predictions[0]!.outcome).toBe("unknown");
  const empty = attemptRow(d, REFERENCE[d.id]!, prediction(d));
  const e = snapshot(empty).metrics.db!.security!.edges[0]!; e.admitted = 0; e.backendDeliveries = 0;
  expect(buildRunReport(empty).challenge!.predictions[0]!.outcome).toBe("unknown");
});
