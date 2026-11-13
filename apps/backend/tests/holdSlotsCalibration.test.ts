import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs } from "../deployments/runInputs";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import { challengeSeed, specHash } from "../challenges/registry";
import { improvementSource } from "../challenges/improvements";
import { buildRunReport } from "../reports/report";
import { answers, attemptRow } from "./challengeHarness";
import { holdSlotsLabFixture } from "./holdSlotsLab.fixture";

test("hold slots: one concurrency edit clears the backlog; a larger worker near miss stays blocked", () => {
  const {d, designs, rows} = holdSlotsLabFixture(), reports = rows.map(r => buildRunReport(r));
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"hold-slots-on-a-slow-call@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const s of designs) expect(preflight(d, s).errors).toEqual([]);
  for (const i of [1, 2]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({classification: "one-change", count: 1});
  expect(reviewDesignChanges(inputs[0]!, inputs[1]!).differences!.reconfigured[0]!.fields[0]!.field).toContain("asyncWorker");
  expect(inputs[0]!.adapterProfiles).toContain("worker-wait/1");
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  const detail = reports.map(r => r.challenge!.criteria.find(c => c.id === "work")!.detail);
  const acked = detail.map(t => Number(/(\d+) acknowledged/.exec(t)![1])), outstanding = detail.map(t => Number(/(\d+) outstanding/.exec(t)![1]));
  const cpu = reports.map(r => r.terminal!.resources.find(x => x.id === "worker")!.cpu!);
  expect(acked).toEqual([79, 316, 79]); expect(outstanding).toEqual([241, 4, 241]);
  expect(cpu[0]!).toBeLessThan(10); expect(cpu[2]!).toBeLessThan(cpu[0]!);
  expect(acked[1]! - 280).toBeGreaterThanOrEqual(30); expect(280 - acked[0]!).toBeGreaterThan(150); expect(12 - outstanding[1]!).toBeGreaterThanOrEqual(8);
  for (const [i, row] of rows.entries()) {
    const replayed = buildRunReport({...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))});
    expect(replayed.terminal).toEqual(reports[i]!.terminal); expect(replayed.challenge).toEqual(reports[i]!.challenge);
    expect(reports[i]!.challenge!.predictions[0]!.predicted).toBe("degraded");
  }
  expect(improvementSource(rows[0]!, d.id).input).toEqual(inputs[0]!);
  console.info("hold-slots-calibration", JSON.stringify({acked, outstanding, cpu, health: reports.map(r => r.challenge!.predictions[0]!.actual)}));
}, 120000);

test("hold slots: two and three parallel jobs (up to the core count and one over it) still leave a backlog; four are needed", () => {
  const {d, designs} = holdSlotsLabFixture();
  const rows = [2, 3].map(n => { const s = structuredClone(designs[0]!); s.resources.find(r => r.id === "worker")!.asyncWorker!.concurrency = n; return attemptRow(d, s, answers(d, {health: "degraded"})); });
  const reports = rows.map(r => buildRunReport(r)), detail = reports.map(r => r.challenge!.criteria.find(c => c.id === "work")!.detail);
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "not-met"]);
  expect(detail.map(t => Number(/(\d+) acknowledged/.exec(t)![1]))).toEqual([158, 237]);
  expect(detail.map(t => Number(/(\d+) outstanding/.exec(t)![1]))).toEqual([162, 83]);
});

test("lesson is registered in its own module with limitations and the pinned review record", async () => {
  const { findLearningLesson, LEARNING_REGISTRY } = await import("../learning/registry");
  const { learningContent } = await import("../learning/content"), { validateLearningContent } = await import("../learning/validate");
  const { checkLessonClaims } = await import("../learning/claims"), { REVIEWED_CHALLENGES } = await import("../learning/reviewedChallenges");
  const {d} = holdSlotsLabFixture(), lesson = findLearningLesson(d.id)!;
  expect(lesson).toMatchObject({kind: "executable-lab", trackId: "async", moduleId: "held-capacity", experiment: {challengeId: d.id}, check: null});
  expect(LEARNING_REGISTRY.findModule("async", "held-capacity")!.lessonIds).toEqual([d.id]);
  expect(REVIEWED_CHALLENGES[`${lesson.id}@1`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
  expect(validateLearningContent(learningContent)).toEqual([]); expect(checkLessonClaims(lesson, d)).toEqual([]);
  expect(lesson.limitations.join(" ")).toContain("no connection pools, timeouts or retries");
});
