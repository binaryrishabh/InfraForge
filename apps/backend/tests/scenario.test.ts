import { expect, test } from "bun:test";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { readFile } from "node:fs/promises";
import { boundRetriesDuringSlowdownV1 as d } from "../challenges/definitions/bound-retries-during-slowdown/v1";
import { recordedScenario } from "../challenges/scenario";
import { improvementSource } from "../challenges/improvements";
import { learningAttempt } from "../challenges/history";
import { preflight } from "../challenges/preflight";
import { validateChallengeVersions } from "../challenges/validate";
import { buildRunReport } from "../reports/report";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { applyAction } from "../simulator/actionApplication";
import { advanceTickBatch, scenarioDue } from "../simulator/tickBatch";
import type { SimulationInstance } from "../simulator/instance";
import { dueScenarioSteps } from "@infraforge/simulation/model2-run";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";

const prediction = answers(d, {"overall-health": "saturated"});
const reference = attemptRow(d, REFERENCE[d.id]!, prediction);
test("DB slowdown starter fails and bounded retries pass from exact terminal p95 evidence", () => {
  const pass = buildRunReport(reference), fail = buildRunReport(attemptRow(d, d.starter!, prediction));
  expect(pass.challenge).toMatchObject({status: "met", metCount: 3, total: 3});
  expect(fail.challenge).toMatchObject({status: "not-met", metCount: 2, total: 3});
  expect(pass.terminal!.traffic!.latencyMs.p95!).toBeLessThan(1000);
  expect(fail.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(1000);
  expect(pass.actions[0]).toMatchObject({scenarioStepId: "db-slowdown", appliedSimulatedSeconds: 2, completedSimulatedSeconds: 5,
    outcome: {intervention: {atUs: 2_000_001, endUs: 4_000_001}, interventionEnded: true}});
});
test("missing, wrong, extra, truncated, early or mismatched scenario evidence is unscored", () => {
  const mutations: Array<(r: typeof reference) => void> = [
    r => { r.actions = []; },
    r => { r.actions![0]!.scenarioStepId = "wrong"; },
    r => { r.actions!.push({...r.actions![0]!, id: "extra", sequence: 2}); },
    r => { r.actions![0]!.appliedSimulatedSeconds = 3; },
    r => { r.actions![0]!.completedSimulatedSeconds = 4; },
    r => { r.actions![0]!.parameters = {...r.actions![0]!.parameters as object, extra: true}; },
    r => { r.actions![0]!.outcome = {...r.actions![0]!.outcome as object, interventionEnded: false}; },
    r => { const outcome = r.actions![0]!.outcome as {intervention: {resolvedTargets: string[]}}; outcome.intervention.resolvedTargets = ["substitute"]; },
    r => { (r.terminalSnapshot as {simulatedSeconds: number}).simulatedSeconds = 4; },
    r => { r.actionCount = 9; },
  ];
  for (const mutate of mutations) { const row = structuredClone(reference); mutate(row); expect(buildRunReport(row).challenge?.status).toBe("not-evaluated"); }
  for (const traffic of [undefined, {offeredRps: 1, completedRps: 0, failedRps: 1, latencyMs: {p50: null, p95: null}}]) {
    const row = structuredClone(reference); (row.terminalSnapshot as {traffic?: unknown}).traffic = traffic;
    expect(buildRunReport(row).challenge?.criteria.find(c => c.id === "latency")?.status).toBe("not-evaluated");
  }
  const forged = structuredClone(reference); (forged.challengeScenario as {definitionHash: string}).definitionHash = "0".repeat(64);
  expect(buildRunReport(forged).challenge?.status).toBe("unavailable");
});
test("preflight refuses missing and unsupported targets, and authoring rejects experiment plus scenario", () => {
  const missing = structuredClone(d.starter!); missing.resources = missing.resources.filter(r => r.id !== "db");
  expect(preflight(d, missing).valid).toBe(false);
  expect(() => recordedScenario(d, captureRunInputs(missing, d.workload))).toThrow();
  const wrong = structuredClone(d.starter!); wrong.resources.find(r => r.id === "db")!.type = "Cache";
  expect(() => recordedScenario(d, captureRunInputs(wrong, d.workload))).toThrow();
  const mixed = {...d, experiment: {fault: DeploymentChaosNames.Crash, atSimulatedSecond: 2, target: {resourceId: "db", type: "Database" as const}, hypothesis: "Observe"}};
  expect(validateChallengeVersions([mixed], {}).some(p => p.includes("exclude experiments"))).toBe(true);
});
test("preflight and authoring refuse a database reached only by an unoffered operation", () => {
  const design = structuredClone(d.starter!);
  design.resources.find(r => r.id === "lb")!.retry = {enabled: false};
  design.resources.push({id: "unused", type: "Virtual Machine", x: 800, y: 900});
  design.resources.find(r => r.id === "app0")!.applicationFlow = {schema: "application-flow/1", operations: {
    read: {steps: [{id: "compute", kind: "compute"}]},
    write: {steps: [{id: "call", kind: "call", edge: "unused-path"}]},
  }};
  design.connectionLines = design.connectionLines.filter(e => e.targetId !== "db");
  design.connectionLines.push(
    {id: "unused-path", sourceId: "app0", targetId: "unused", sourceType: "Virtual Machine", targetType: "Virtual Machine", port: 80},
    {id: "unused-db", sourceId: "unused", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432},
  );
  expect(() => recordedScenario(d, captureRunInputs(design, d.workload))).toThrow("serving path");
  expect(preflight(d, design).errors.some(p => p.includes("serving path"))).toBe(true);
  expect(validateChallengeVersions([{...d, starter: design}], {}).some(p => p.includes("serving path"))).toBe(true);
  // Offering writes makes the same compiled dependency active.
  expect(() => recordedScenario({...d, workload: {...d.workload, readWriteRatio: 0}}, captureRunInputs(design, {...d.workload, readWriteRatio: 0}))).not.toThrow();
});
test("history preserves scenario scoring and improvement requires the exact stored source plan", () => {
  expect(learningAttempt(reference)).toMatchObject({category: "resilience", fault: null, status: "met", metCount: 3});
  expect(improvementSource(reference, d.id).definition.id).toBe(d.id);
  expect(() => improvementSource({...reference, challengeScenario: null}, d.id)).toThrow("recorded scenario");
  const forged = structuredClone(reference); (forged.challengeScenario as {receipts: unknown[]}).receipts = [];
  expect(() => improvementSource(forged, d.id)).toThrow("recorded scenario");
});
test("fast server batches freeze on every due boundary and pending durable row", async () => {
  const input = captureRunInputs(d.starter!, d.workload), plan = recordedScenario(d, input)!;
  const instance: SimulationInstance = {model2: createModel2Engine(input, 5), tickCount: 0, pendingLogs: [], speed: 3600,
    lastCheckpointAt: 0, accumulatedCostUsd: 0, topology: input, topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: null, metricsTopologyRevision: 0, autoStopAtSimulatedSeconds: 5, scenario: {plan, next: 0, pending: new Set()}};
  for (let i = 0; i < 10 && !scenarioDue(instance); i++) await advanceTickBatch(instance, async () => {});
  expect(instance.model2.simulatedSeconds).toBe(2);
  // A failed durable insert leaves the cursor here; even the fastest batch cannot cross it.
  await advanceTickBatch(instance, async () => {}); expect(instance.model2.simulatedSeconds).toBe(2);
  instance.scenario!.next = 1; instance.scenario!.pending.add("db-slowdown");
  await advanceTickBatch(instance, async () => {}); expect(instance.model2.simulatedSeconds).toBe(2);
  const step = dueScenarioSteps(plan, 0, 2)[0]!;
  applyAction(instance, "durable-row", {kind: "intervention", parameters: step.request});
  instance.scenario!.pending.clear();
  for (let i = 0; i < 10 && instance.model2.simulatedSeconds < 5; i++) await advanceTickBatch(instance, async () => {});
  expect(instance.model2.simulatedSeconds).toBe(5);
  expect(instance.model2.actions[0]).toMatchObject({atUs: 2_000_001});
});
test("the scenario migration is additive and the latest registered guard definition", async () => {
  const {ADDITIVE_MIGRATIONS} = await import("../release/migrations");
  expect([...ADDITIVE_MIGRATIONS].at(-1)).toBe("20261030010000_challenge_scenarios");
  const sql = await readFile(new URL("../prisma/migrations/20261030010000_challenge_scenarios/migration.sql", import.meta.url), "utf8");
  expect(sql).toContain('UNIQUE INDEX "RunAction_deploymentId_scenarioStepId_key"');
  expect(sql).toContain("step->'request' = NEW.parameters");
});
