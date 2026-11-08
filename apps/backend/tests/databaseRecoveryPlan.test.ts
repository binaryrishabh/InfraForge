import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ChallengeStarter, RecordedScenario } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { restoreADatabaseWriterV1 as d } from "../challenges/definitions/restore-a-database-writer/v1";
import { preflight } from "../challenges/preflight";
import { recordedScenario, verifiedScenario } from "../challenges/scenario";
import { buildRegistry, challengeSeed, specHash } from "../challenges/registry";
import { validateChallengeVersions } from "../challenges/validate";
import { reviewDesignChanges } from "../challenges/designChanges";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { buildRunReport } from "../reports/report";
import { createModel2Engine } from "../simulator/model2Engine";
import { checkSubmission } from "../browserRuns/submission";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";

const prediction = answers(d, {"overall-health": "healthy"});
const input = (design: ChallengeStarter) => captureRunInputs(design, d.workload, challengeSeed(d));
const raw = (row: ReturnType<typeof attemptRow>) => row.terminalSnapshot as SimulationSnapshot;
const choice = (second: number | null) => {
  const design = structuredClone(d.starter!); design.resources.find(r => r.id === "db")!.databaseRecoveryPlan!.promoteAtSecond = second; return design;
};
const db = (r: ReturnType<typeof buildRunReport>) => r.terminal!.resources.find(r => r.id === "db")!.databaseReplication!;

test("one saved promotion choice changes real incident outcomes, with a failing late plan and honest one-change review", () => {
  const designs = [d.starter!, REFERENCE[d.id]!, choice(8)];
  const rows = designs.map(s => attemptRow(d, s, prediction)), reports = rows.map(r => buildRunReport(r));
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  expect(reports.map(r => r.terminal!.traffic!.wholeRun!.completed)).toEqual([60, 130, 80]);
  expect(reports.map(r => r.terminal!.traffic!.wholeRun!.failed)).toEqual([80, 10, 60]);
  expect(reports.map(r => db(r).replicaCommittedWrites)).toEqual([0, 110, 60]);
  expect(reviewDesignChanges(input(designs[0]!), input(designs[1]!))).toMatchObject({classification: "one-change", count: 1,
    differences: {reconfigured: [{id: "db", fields: [{field: "databaseRecoveryPlan", earlier: {version: 1, promoteAtSecond: null}, later: {version: 1, promoteAtSecond: 3}}]}]}});
  expect(input(designs[0]!).adapterProfiles).toEqual(input(designs[1]!).adapterProfiles);
  for (const [i, report] of reports.entries()) {
    const row = rows[i]!;
    expect(preflight(d, designs[i]!).errors).toEqual([]);
    const saved = {...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), challengeScenario: JSON.parse(JSON.stringify(row.challengeScenario)),
      terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot)), actions: structuredClone(row.actions)};
    expect(buildRunReport(saved).challenge).toEqual(report.challenge);
    expect(buildRunReport(saved).terminal).toEqual(report.terminal);
    expect(report.terminal!.traffic!.wholeRun).toMatchObject({throughSecond: 14, inFlight: 0, deadlineExceeded: 0, abandoned: 0});
    expect(report.databaseRecoveryPlan?.hash).toMatch(/^[a-f0-9]{64}$/);
    const failure = report.actions[0]!.outcome!.databaseIncident!;
    expect(failure.before).toMatchObject({simulatedSecond: 2, completed: 20, failed: 0, replication: {currentWriter: "primary", primaryCommittedWrites: 20}});
    expect(failure.during).toMatchObject({simulatedSecond: 3, completed: 20, failed: 10, replication: {currentWriter: "none", primaryProcessState: "unavailable", replicaProcessState: "available", failedWritesWithoutWriter: 10}});
    expect(failure.after?.simulatedSecond).toBe(11);
    expect(failure.after?.replication?.currentWriter).toBe(i ? "replica" : "primary");
    if (i) {
      expect(failure.after?.replication).toMatchObject({primaryProcessState: "fenced", primaryRole: "fenced", replicaRole: "writer", writerEpoch: 2});
      expect(db(report)).toMatchObject({currentWriter: "replica", primaryProcessState: "fenced", primaryCommittedWrites: 20, promotionCount: 1, sessionInvalidations: 2, connectionInvalidations: 2});
      const promotion = report.actions[1]!.outcome!.databaseIncident!;
      expect(promotion.before.replication?.currentWriter).toBe("none");
      expect(promotion.after?.replication?.currentWriter).toBe("replica");
      expect(promotion.after?.replication?.replicaCommittedWrites).toBe(10);
    }
    console.info(JSON.stringify({lab: d.id, promotionSecond: [null, 3, 8][i], baseline: failure.before.completed,
      completed: report.terminal!.traffic!.wholeRun!.completed, failed: report.terminal!.traffic!.wholeRun!.failed,
      writer: db(report).currentWriter, primary: db(report).primaryProcessState, promotedCommits: db(report).replicaCommittedWrites}));
  }
  const {scenario: _scenario, ...healthy} = d;
  const healthyReport = buildRunReport(attemptRow(healthy, d.starter!, prediction), buildRegistry([healthy]));
  expect(healthyReport.terminal!.traffic!.wholeRun).toMatchObject({completed: 140, failed: 0});
});

test("recovery plans are captured, hashed and reconstructed independently; altered identities never score", () => {
  const captured = input(REFERENCE[d.id]!), plan = recordedScenario(d, captured)!;
  expect(plan.steps.map(s => s.id)).toEqual(["fail-primary", "learner-promotion"]);
  expect(plan.receipts.map(r => [r.interventionId, r.atUs, r.endUs])).toEqual([["db-fail-primary", 2_000_001, 10_000_001], ["db-promote-replica", 3_000_001, null]]);
  expect(verifiedScenario(JSON.parse(JSON.stringify(plan)), d, readRunInputs(JSON.parse(JSON.stringify(captured))))).toEqual(plan);
  const alternate = recordedScenario(d, input(choice(4)))!;
  expect(alternate.recoveryPlanHash).not.toBe(plan.recoveryPlanHash);
  for (const mutate of [
    (p: RecordedScenario) => { p.recoveryPlanHash = "0".repeat(64); },
    (p: RecordedScenario) => { p.steps[1]!.atSecond = 4; },
    (p: RecordedScenario) => { p.steps[1]!.request.target = {resourceId: "app"}; },
    (p: RecordedScenario) => { p.receipts[1]!.resolvedTargets = ["app"]; },
  ]) {
    const changed = structuredClone(plan); mutate(changed);
    expect(() => verifiedScenario(changed, d, captured)).toThrow("does not match");
    const row = attemptRow(d, REFERENCE[d.id]!, prediction); row.challengeScenario = changed;
    expect(buildRunReport(row).challenge!.status).toBe("unavailable");
  }
  expect(() => checkSubmission({stopAtSecond: 14, actions: [{atSecond: 3, request: {kind: "intervention", parameters: plan.steps[1]!.request}}]}, {challenge: true, horizonSeconds: 14})).toThrow("takes no actions");
});

test("preflight refuses missing, malformed, out-of-window, disabled, missing-target and off-path recovery plans", () => {
  for (const second of [1, 2, 10, 13, 14, 15, 3.5]) expect(preflight(d, choice(second)).valid).toBe(false);
  const missing = choice(null); delete missing.resources[1]!.databaseRecoveryPlan;
  expect(preflight(d, missing).errors.join()).toContain("Save a recovery plan");
  const disabled = choice(3); delete disabled.resources[1]!.databaseReplication;
  expect(preflight(d, disabled).errors.join()).toContain("replica");
  const removed = choice(3); removed.resources = removed.resources.filter(r => r.id !== "db"); removed.connectionLines = [];
  expect(preflight(d, removed).valid).toBe(false);
  const offPath = choice(3); offPath.connectionLines = [];
  expect(preflight(d, offPath).valid).toBe(false);
  const wrongType = choice(3); wrongType.resources[1]!.type = "Cache";
  expect(() => input(wrongType)).toThrow("invalid");
  const extra = choice(3); Object.assign(extra.resources[1]!.databaseRecoveryPlan!, {bypass: true});
  expect(() => input(extra)).toThrow("invalid");
  const otherTarget = choice(3); otherTarget.resources[0]!.databaseRecoveryPlan = {version: 1, promoteAtSecond: 3};
  expect(() => input(otherTarget)).toThrow("invalid");
});

test("missing incident or caller proof stays unscored; loss is retained separately from zero pending work", () => {
  const row = attemptRow(d, REFERENCE[d.id]!, prediction);
  for (const mutate of [
    (r: typeof row) => { r.actions = []; },
    (r: typeof row) => { (r.actions![0]!.outcome as {databaseIncident?: unknown}).databaseIncident = undefined; },
    (r: typeof row) => { r.actions![1]!.completedAt = null; },
    (r: typeof row) => { raw(r).traffic!.wholeRun = undefined; },
    (r: typeof row) => { r.terminalSnapshot = null; },
  ]) { const missing = structuredClone(row); mutate(missing); expect(buildRunReport(missing).challenge!.status).toBe("not-evaluated"); }
  const delayed = structuredClone(REFERENCE[d.id]!); delayed.resources[1]!.databaseReplication!.replicationDelayMs = 60000;
  const report = buildRunReport(attemptRow(d, delayed, prediction));
  expect(db(report)).toMatchObject({pendingReplication: 0, lostOperations: 20, regressedKeyCount: 5, replicaCommittedWrites: 110});
  expect(db(report).regressedKeys).toContainEqual({key: "key-1", primaryVersion: 15, promotedVersion: 1});
  const unknown = structuredClone(row); raw(unknown).metrics.db!.databaseReplication!.lostOperations = null;
  expect(db(buildRunReport(unknown)).lostOperations).toBeNull();
});

test("saved plan metadata adds no database behavior; authored pin and title satisfy the existing gates", () => {
  const captured = input(REFERENCE[d.id]!), plain = structuredClone(captured); delete plain.resources[1]!.databaseRecoveryPlan;
  const withPlan = createModel2Engine(captured, 14), without = createModel2Engine(plain, 14), plan = recordedScenario(d, captured)!;
  for (let second = 1; second <= 14; second++) {
    withPlan.advance(); without.advance(); expect(withPlan.view()).toEqual(without.view()); expect(withPlan.evidence()).toEqual(without.evidence());
    for (const step of plan.steps.filter(s => s.atSecond === second)) for (const run of [withPlan, without]) run.apply({kind: "intervention", parameters: step.request});
  }
  const hash = /"restore-a-database-writer@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!;
  expect(specHash(d)).toBe(hash); expect(validateChallengeVersions([d], {[`${d.id}@1`]: hash})).toEqual([]);
  expect(validateInfrastructureName(d.title)).toBeNull();
});
