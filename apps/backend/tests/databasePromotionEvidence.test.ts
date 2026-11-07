import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel2Run, compileScenario } from "@infraforge/simulation/model2-run";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import type { ChallengeScenario } from "@infraforge/contracts/challenges";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { preflight } from "../challenges/preflight";
import { recordedScenario } from "../challenges/scenario";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { learningContent } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { validateLearningContent } from "../learning/validate";
import { buildRunReport } from "../reports/report";
import { shareACacheFillV1 } from "../challenges/definitions/share-a-cache-fill/v1";
import { promotionActions, promotionInput, promotionRun } from "./databasePromotion.fixture";

const reportFor = (promoteAt: number | null, delay = 1) => buildRunReport(promotionRun(promoteAt, delay).row);
const replication = (report: ReturnType<typeof reportFor>) => report.terminal!.resources.find(r => r.id === "db")!.databaseReplication!;
const raw = (r: ReturnType<typeof promotionRun>["row"]) => r.terminalSnapshot as SimulationSnapshot;

test("freeform promotion comparison: early promotion restores writer work; late promotion retains earlier caller failures", () => {
  const runs = [null, 2, 5].map(at => promotionRun(at));
  expect(runs[1]!.row.runInputs).toEqual(runs[0]!.row.runInputs);
  expect(runs[2]!.row.runInputs).toEqual(runs[0]!.row.runInputs);
  expect(runs[0]!.samples[4]!.view.metrics.db!.databaseReplication).toMatchObject({currentWriter: "none", replicaProcessState: "available", failedWritesWithoutWriter: 40});
  const reports = runs.map(r => buildRunReport(r.row));
  expect(reports.map(r => r.terminal!.traffic!.wholeRun!.completed)).toEqual([30, 70, 40]);
  expect(reports.map(r => r.terminal!.traffic!.wholeRun!.failed)).toEqual([50, 10, 40]);
  expect(reports.map(r => replication(r).replicaCommittedWrites)).toEqual([0, 60, 30]);
  expect(replication(reports[0]!)).toMatchObject({currentWriter: "primary", promotionCount: 0, failedWritesWithoutWriter: 50});
  for (const r of reports.slice(1)) expect(replication(r)).toMatchObject({currentWriter: "replica", primaryProcessState: "fenced", writerEpoch: 2, promotionCount: 1});
  for (const [i, r] of reports.entries()) {
    expect(r.challenge).toBeNull(); // Regression evidence never masquerades as a scored lab.
    expect(r.terminal!.traffic!.wholeRun).toMatchObject({throughSecond: 8, inFlight: 0, deadlineExceeded: 0, abandoned: 0});
    const row = runs[i]!.row;
    const saved = {...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))};
    expect(buildRunReport(saved).terminal).toEqual(r.terminal);
    expect(r.actions.every(a => a.status === "completed")).toBe(true);
    console.info(JSON.stringify({regression: "promotion-timing", promoteAt: [null, 2, 5][i],
      completed: r.terminal!.traffic!.wholeRun!.completed, failed: r.terminal!.traffic!.wholeRun!.failed,
      promotedWriterCommits: replication(r).replicaCommittedWrites, pending: replication(r).pendingReplication}));
  }
});

test("zero pending replication after promotion does not establish preservation of earlier commits", () => {
  const fastInput = promotionInput(1), slowInput = promotionInput(60000), restored = structuredClone(slowInput);
  restored.resources.find(r => r.id === "db")!.databaseReplication!.replicationDelayMs = 1;
  expect(restored).toEqual(fastInput);
  const reports = [1, 60000].map(delay => reportFor(2, delay));
  expect(reports.map(r => replication(r).replicaCommittedWrites)).toEqual([60, 60]);
  expect(reports.map(r => replication(r).pendingReplication)).toEqual([0, 0]);
  expect(reports.map(r => replication(r).lostOperations)).toEqual([0, 10]);
  expect(replication(reports[1]!).regressedKeyCount).toBeGreaterThan(0);
  expect(reports[0]!.terminal!.traffic).toEqual(reports[1]!.terminal!.traffic);
  for (const [i, r] of reports.entries()) console.info(JSON.stringify({regression: "promotion-preservation", delayMs: [1, 60000][i],
    primaryCommits: replication(r).primaryCommittedWrites, promotedWriterCommits: replication(r).replicaCommittedWrites,
    pending: replication(r).pendingReplication, lost: replication(r).lostOperations}));
  expect(LEARNING_REPORT_MEASUREMENTS["Promoted writer commits"].path).toBe("databaseReplication.replicaCommittedWrites");
  expect(LEARNING_REPORT_MEASUREMENTS["Pending replication"].path).toBe("databaseReplication.pendingReplication");
});

test("saved promotion reports preserve missing as Unknown and refuse malformed replication measurements", () => {
  const {row} = promotionRun(2);
  const historical = structuredClone(row); delete raw(historical).metrics.db!.databaseReplication;
  expect(replication(buildRunReport(historical))).toBeUndefined();
  const unknown = structuredClone(row); raw(unknown).metrics.db!.databaseReplication!.replicaCommittedWrites = null;
  expect(replication(buildRunReport(unknown)).replicaCommittedWrites).toBeNull();
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const malformed = structuredClone(row); raw(malformed).metrics.db!.databaseReplication!.pendingReplication = value;
    expect(buildRunReport(malformed).terminal).toBeNull();
  }
  const missing = structuredClone(row); missing.terminalSnapshot = null;
  expect(buildRunReport(missing).terminal).toBeNull();
});

test("all three database interventions remain refused in challenge scripts and preflight", () => {
  for (const interventionId of ["db-fail-primary", "db-fail-replica", "db-promote-replica"]) {
    const scenario: ChallengeScenario = {version: 1, visibility: "revealed", steps: [{id: "database-action", atSecond: 1,
      request: {interventionId, revision: 1, target: {resourceId: "db"}, parameters: interventionId === "db-promote-replica" ? {} : {duration: 2}}}]};
    const input = promotionInput();
    expect(() => compileScenario(scenario, input, 8)).toThrow("only in Free World live runs");
    const candidate = {...shareACacheFillV1, evaluationSeconds: 8, starter: {resources: input.resources, connectionLines: input.connectionLines}, scenario};
    expect(() => recordedScenario(candidate, captureRunInputs(candidate.starter, candidate.workload))).toThrow("only in Free World live runs");
    expect(preflight(candidate, candidate.starter).valid).toBe(false);
  }
});

test("freeform promotion matches browser-target execution and server replay, including replica interruption", async () => {
  const path = resolve(import.meta.dir, `../../../.cache/promotion-evidence-browser-${process.pid}.mjs`);
  await mkdir(dirname(path), {recursive: true});
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", path], {stdout: "ignore", stderr: "pipe"});
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browserFactory: typeof createModel2Run = (await import(pathToFileURL(path).href)).createModel2Run;
    for (const [promoteAt, delay, outage] of [[null, 1, "primary"], [2, 1, "primary"], [5, 1, "primary"], [2, 60000, "primary"], [null, 2000, "replica"]] as const) {
      const input = readRunInputs(JSON.parse(JSON.stringify(promotionInput(delay))));
      const browser = browserFactory(input, 8), replay = promotionRun(promoteAt, delay, outage);
      for (let second = 1; second <= 8; second++) {
        browser.advance();
        expect(browser.view()).toEqual(replay.samples[second - 1]!.view);
        expect(browser.evidence()).toEqual(replay.samples[second - 1]!.evidence);
        const evidence = browser.evidence().data.databases[0]!.databaseReplication!;
        if (second === 2 && delay === 60000) expect(evidence.pendingReplication).toBe(10);
        if (second === 3 && delay === 60000) { expect(evidence.pendingReplication).toBe(0); expect(evidence.lostOperations).toBe(10); }
        if (outage === "replica" && second === 6) {
          expect(evidence.currentWriter).toBe("primary"); expect(evidence.pendingReplication).toBeGreaterThan(40);
          expect(evidence.failedWritesWithoutWriter).toBe(0);
        }
        for (const action of promotionActions(promoteAt, outage).filter(a => a.atSecond === second)) browser.apply(action.request);
      }
      const report = buildRunReport(replay.row), final = browser.view().metrics.db!.databaseReplication!;
      expect(replication(report)).toEqual(final); expect(report.terminal!.traffic).toEqual(browser.view().traffic);
      if (outage === "replica") {
        expect(final).toMatchObject({currentWriter: "primary", promotionCount: 0, failedWritesWithoutWriter: 0});
        expect(final.replicaAppliedWrites).toBeGreaterThan(40);
        expect(browser.view().traffic.wholeRun).toMatchObject({completed: 80, failed: 0});
      }
    }
  } finally { if (await Bun.file(path).exists()) await unlink(path); }
});

test("writer-failure curriculum is canonical conceptual content with checks and explicit proof limits", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  const module = LEARNING_REGISTRY.findTrack("data")!.modules.find(m => m.id === "writer-failure")!;
  expect(module.lessonIds).toEqual(["promoting-a-replica", "promotion-and-pending-work"]);
  for (const id of module.lessonIds) {
    const lesson = LEARNING_REGISTRY.findLesson(id)!;
    expect(lesson).toMatchObject({kind: "conceptual-exercise", experiment: null, contentVersion: 1});
    expect(lesson.check!.choices.some(c => c.id === lesson.check!.correctChoiceId)).toBe(true);
    expect(lesson.limitations.join(" ")).toMatch(/data.loss/);
    expect(lesson.limitations.join(" ")).toMatch(/DNS/);
    expect(lesson.limitations.join(" ")).toMatch(/reconnect/);
  }
});
