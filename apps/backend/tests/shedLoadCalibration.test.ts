import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs } from "../deployments/runInputs";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import { challengeSeed, specHash } from "../challenges/registry";
import { improvementSource } from "../challenges/improvements";
import { buildRunReport } from "../reports/report";
import { shedLoadLabFixture } from "./shedLoadLab.fixture";

const num = (t: string, re: RegExp) => Number(re.exec(t)![1]);
test("shed load: one active-request edit bounds the tail; a larger app near miss still fails the tail", () => {
  const {d, designs, rows} = shedLoadLabFixture(), reports = rows.map(r => buildRunReport(r));
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"shed-load-at-the-edge@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const s of designs) expect(preflight(d, s).errors).toEqual([]);
  for (const i of [1, 2]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({classification: "one-change", count: 1});
  expect(reviewDesignChanges(inputs[0]!, inputs[1]!).differences!.reconfigured[0]!.fields[0]!.field).toContain("lbAdmission");
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  const lat = reports.map(r => num(r.challenge!.criteria.find(c => c.id === "latency")!.detail, /p95 was ([\d.]+) ms/));
  const done = reports.map(r => num(r.challenge!.criteria.find(c => c.id === "work")!.detail, /: (\d+) completed/));
  expect(lat[0]!).toBeGreaterThan(500); expect(lat[1]!).toBeLessThan(60); expect(lat[2]!).toBeGreaterThan(150);
  expect(done[1]!).toBeGreaterThan(3200); expect(done[1]!).toBeGreaterThanOrEqual(done[0]!);
  for (const [i, row] of rows.entries()) {
    const replayed = buildRunReport({...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))});
    expect(replayed.terminal).toEqual(reports[i]!.terminal); expect(replayed.challenge).toEqual(reports[i]!.challenge);
    expect(reports[i]!.challenge!.predictions[0]).toMatchObject({predicted: "critical", actual: "critical", outcome: "matched"});
  }
  expect(improvementSource(rows[0]!, d.id).input).toEqual(inputs[0]!);
  console.info("shed-load-calibration", JSON.stringify({lat, done}));
}, 120000);

test("lesson is registered in its own module with limitations and the pinned review record", async () => {
  const { findLearningLesson, LEARNING_REGISTRY } = await import("../learning/registry");
  const { learningContent } = await import("../learning/content"), { validateLearningContent } = await import("../learning/validate");
  const { checkLessonClaims } = await import("../learning/claims"), { REVIEWED_CHALLENGES } = await import("../learning/reviewedChallenges");
  const {d} = shedLoadLabFixture(), lesson = findLearningLesson(d.id)!;
  expect(lesson).toMatchObject({kind: "executable-lab", trackId: "scaling", moduleId: "edge-admission", experiment: {challengeId: d.id}, check: null});
  expect(LEARNING_REGISTRY.findModule("scaling", "edge-admission")!.lessonIds.filter(id => id === d.id)).toEqual([d.id]);
  expect(REVIEWED_CHALLENGES[`${lesson.id}@1`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
  expect(validateLearningContent(learningContent)).toEqual([]); expect(checkLessonClaims(lesson, d)).toEqual([]);
  expect(lesson.limitations.join(" ")).toContain("no availability guarantee");
});
