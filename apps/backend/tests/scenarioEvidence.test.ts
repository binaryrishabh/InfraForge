import { expect, test } from "bun:test";
import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import { boundRetriesDuringSlowdownV1 as d } from "../challenges/definitions/bound-retries-during-slowdown/v1";
import { REFERENCE, answers, attemptRow, legacyDefinition } from "./challengeHarness";
import { buildRegistry, specHash } from "../challenges/registry";
import { recordedScenario } from "../challenges/scenario";
import { evaluateAttempt } from "../challenges/evaluate";
import { readRunInputs } from "../deployments/runInputs";
import { buildRunReport, type StoredRun } from "../reports/report";
import { readRecords } from "../reports/records";

const reference = attemptRow(d, REFERENCE[d.id]!, answers(d, {"overall-health": "saturated"}));
const input = readRunInputs(reference.runInputs);
type Gates = Array<{name: string; details?: unknown}>;
type Snapshot = {metrics: Record<string, {health?: string; connections?: number | null}>; traffic: {completedRps: number; latencyMs: {p50: number | null; p95: number | null}}};
const stages = (row: StoredRun) => row.stages as Gates;
const snapshot = (row: StoredRun) => row.terminalSnapshot as Snapshot;
const criterion = (value: Omit<ChallengeCriterion, "id" | "label">): ChallengeCriterion => ({id: "probe", label: "Probe", ...value} as ChallengeCriterion);
function fixture(c: ChallengeCriterion) {
  const definition = {...d, criteria: [c, {id: "static-failure", label: "Known budget failure", kind: "monthly-budget" as const, maxUsd: 0}]};
  const row = structuredClone(reference), registry = buildRegistry([definition]);
  row.challengeSpecHash = specHash(definition); row.challengeScenario = recordedScenario(definition, input);
  return {row, registry, definition};
}
function unknown(c: ChallengeCriterion, mutations: Array<(row: StoredRun) => void>) {
  for (const mutate of mutations) {
    const {row, registry} = fixture(c); mutate(row);
    const result = buildRunReport(row, registry).challenge!;
    expect(result.definitionMatches).toBe(true);
    expect(result.criteria.find(item => item.id === "probe")?.status).toBe("not-evaluated");
    expect(result.status).toBe("not-evaluated");
  }
}

test("scenario health criteria require every applicable resource, including unknown and partial health", () => {
  for (const c of [criterion({kind: "no-saturation"}), criterion({kind: "database-healthy"}),
    {id: "probe", label: "Probe", kind: "overall-health", allowed: ["healthy"]} as ChallengeCriterion]) {
    unknown(c, [
      row => { snapshot(row).metrics = {}; },
      row => { delete snapshot(row).metrics.db; },
      row => { snapshot(row).metrics.db!.health = "unknown"; },
      row => { delete snapshot(row).metrics.db!.health; },
      row => { (row.terminalSnapshot as {metricsTopologyRevision: number}).metricsTopologyRevision = 1; },
      row => { (row.terminalSnapshot as {metricsComputedAt: null}).metricsComputedAt = null; },
    ]);
  }
  unknown(criterion({kind: "no-saturation"}), [row => {
    snapshot(row).metrics.app0!.health = "failed";
    delete snapshot(row).metrics.app1;
  }]);
});

test("scenario gate criteria retain malformed, absent and duplicate evidence as unknown", () => {
  for (const c of [criterion({kind: "security-clean"}), criterion({kind: "deployment-checks"})]) {
    unknown(c, [undefined, null, {}, {issues: "unreadable"}, {issues: [9]}, {issues: Array(501).fill("finding")}].map(details => row => {
      stages(row).find(stage => stage.name === "SecurityScan")!.details = details;
    }));
    unknown(c, [row => { stages(row).push(structuredClone(stages(row).find(stage => stage.name === "SecurityScan")!)); }]);
  }
  unknown(criterion({kind: "deployment-checks"}), [row => {
    row.stages = stages(row).filter(stage => stage.name !== "Validate");
    row.status = "failed";
  }]);
  unknown(criterion({kind: "deployment-checks"}), [row => { stages(row).find(stage => stage.name === "Validate")!.details = {warnings: "unreadable"}; }]);
  for (const amount of [undefined, null, -1, NaN, Infinity, "2000"]) {
    unknown({id: "probe", label: "Probe", kind: "monthly-budget", maxUsd: 2000}, [row => {
      stages(row).find(stage => stage.name === "CostEstimate")!.details = {monthlyEstimate: amount};
    }]);
  }
});

test("scenario connection and latency criteria require complete valid numeric evidence", () => {
  unknown(criterion({kind: "database-connections"}), [
    row => { delete snapshot(row).metrics.db!.connections; },
    row => { snapshot(row).metrics.db!.connections = null; },
    row => { snapshot(row).metrics.db!.connections = 0.5; },
    row => { (row.terminalSnapshot as {installedSkus: Record<string, string>}).installedSkus.db = "unavailable-sku"; },
    row => { (row.terminalSnapshot as {installedSkus: Record<string, string>}).installedSkus.db = "m5.large"; },
  ]);
  unknown({id: "probe", label: "Probe", kind: "terminal-p95", maxMs: 1000}, [
    row => { snapshot(row).traffic.completedRps = 0; },
    row => { snapshot(row).traffic.latencyMs.p95 = null; },
    row => { snapshot(row).traffic.latencyMs.p50 = null; },
    row => { snapshot(row).traffic.latencyMs.p50 = 1001; snapshot(row).traffic.latencyMs.p95 = 1000; },
    row => { snapshot(row).traffic.latencyMs.p95 = NaN; },
  ]);
});

test("scenario topology criteria require captured topology and complete evidence remains conclusive", () => {
  for (const c of [{id: "probe", label: "Probe", kind: "min-app-servers", count: 1} as ChallengeCriterion,
    criterion({kind: "catalog-sizes"}), criterion({kind: "survivors-unsaturated"})]) {
    const {row, registry, definition} = fixture(c), records = readRecords(row, []), report = buildRunReport(row, registry);
    const result = evaluateAttempt({challengeId: d.id, challengeVersion: 1, challengeSpecHash: specHash(definition),
      challengePrediction: row.challengePrediction, predictionSubmittedAt: row.predictionSubmittedAt!, evaluationStopAtSimulatedSeconds: 5,
      challengeScenario: row.challengeScenario}, {status: "torn-down", runtimeActive: false, input: null, runInputs: input,
      stages: records.stages, terminal: records.terminal, failure: null, actions: report.actions, actionCount: report.actions.length}, registry);
    expect(result.status).toBe("not-evaluated");
  }
  for (const c of [criterion({kind: "deployment-checks"}), criterion({kind: "security-clean"}), criterion({kind: "no-saturation"}),
    criterion({kind: "database-healthy"}), criterion({kind: "database-connections"}), {id: "probe", label: "Probe", kind: "terminal-p95", maxMs: 1000} as ChallengeCriterion]) {
    const {row, registry} = fixture(c);
    expect(["met", "not-met"]).toContain(buildRunReport(row, registry).challenge!.criteria[0]!.status);
  }
  // Historical decoding and aggregation keep their published behavior.
  const old = legacyDefinition("secure-the-edge"), row = structuredClone(reference);
  Object.assign(row, {challengeId: old.id, challengeVersion: old.version, challengeSpecHash: specHash(old), challengeScenario: null,
    challengePrediction: answers(old, Object.fromEntries(old.predictions.map(q => [q.id, q.kind === "security-clean" ? "yes" : "healthy"]))), evaluationStopAtSimulatedSeconds: old.evaluationSeconds});
  stages(row).find(stage => stage.name === "SecurityScan")!.details = {issues: "unreadable"};
  const securityId = old.criteria.find(c => c.kind === "security-clean")!.id;
  expect(buildRunReport(row).challenge!.criteria.find(c => c.id === securityId)?.status).toBe("met");
});
