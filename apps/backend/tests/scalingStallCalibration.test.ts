import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs } from "../deployments/runInputs";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import { challengeSeed, specHash } from "../challenges/registry";
import { improvementSource } from "../challenges/improvements";
import { buildRunReport } from "../reports/report";
import { scalingStallFixture } from "./scalingStall.fixture";

const num = (t: string, re: RegExp) => Number(re.exec(t)![1]);
test("scaling stall: only the export interval clears the first gate; maximum, cache and a bigger app do not", () => {
  const {d, designs, rows} = scalingStallFixture(), reports = rows.map(r => buildRunReport(r));
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"trace-a-scaling-stall@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const s of designs) expect(preflight(d, s).errors).toEqual([]);
  expect(inputs[0]!.adapterProfiles).toEqual(expect.arrayContaining(["autoscaling-observed/1", "artifact-cache/1"]));
  for (const i of [1, 2, 3, 4]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({classification: "one-change", count: 1});
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met", "not-met", "not-met"]);
  const crit = (r: typeof reports[number], id: string) => r.challenge!.criteria.find(c => c.id === id)!;
  const done = reports.map(r => num(crit(r, "callers").detail, /: (\d+) completed/)), bad = reports.map(r => num(crit(r, "callers").detail, /; (\d+) unsuccessful/));
  const inSvc = reports.map(r => num(crit(r, "scaled").detail, /has (\d+) in service/));
  expect(bad).toEqual([3244, 0, 3244, 3244, 0]); expect(inSvc).toEqual([1, 3, 1, 1, 1]);
  expect(done[1]!).toBeGreaterThan(50900); expect(done[0]!).toBeLessThan(47600);
  expect(crit(reports[0]!, "scaled").detail).toContain("9 of 9 evaluations had no usable delivered measurem");
  expect(crit(reports[1]!, "scaled").detail).toContain("0 of 9 evaluations had no usable");
  expect(crit(reports[4]!, "callers").status).toBe("met"); expect(crit(reports[4]!, "scaled").status).toBe("not-met");
  const where = reports.map(r => r.challenge!.predictions.find(p => p.id === "where")!), health = reports.map(r => r.challenge!.predictions.find(p => p.id === "health")!);
  expect(where.map(p => p.actual)).toEqual(["app", "db", "app", "app", "db"]); expect(health[0]).toMatchObject({predicted: "saturated", actual: "saturated", outcome: "matched"});
  expect(where[0]).toMatchObject({predicted: "app", outcome: "matched"});
  for (const [i, row] of rows.entries()) {
    const replayed = buildRunReport({...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))});
    expect(replayed.terminal).toEqual(reports[i]!.terminal); expect(replayed.challenge).toEqual(reports[i]!.challenge);
  }
  expect(improvementSource(rows[0]!, d.id).input).toEqual(inputs[0]!);
  console.info("scaling-stall-calibration", JSON.stringify({done, bad, inSvc}));
}, 600000);

test("lesson is registered in the capstone module with limitations and the pinned review record", async () => {
  const { findLearningLesson, LEARNING_REGISTRY } = await import("../learning/registry");
  const { learningContent } = await import("../learning/content"), { validateLearningContent } = await import("../learning/validate");
  const { checkLessonClaims } = await import("../learning/claims"), { REVIEWED_CHALLENGES } = await import("../learning/reviewedChallenges");
  const {d} = scalingStallFixture(), lesson = findLearningLesson(d.id)!;
  expect(lesson).toMatchObject({kind: "executable-lab", trackId: "diagnosis", moduleId: "capstone-cascades", experiment: {challengeId: d.id}, check: null});
  expect(LEARNING_REGISTRY.findModule("diagnosis", "capstone-cascades")!.lessonIds).toContain(d.id);
  expect(REVIEWED_CHALLENGES[`${lesson.id}@1`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
  expect(validateLearningContent(learningContent)).toEqual([]); expect(checkLessonClaims(lesson, d)).toEqual([]);
  expect(lesson.limitations.join(" ")).toContain("second gate");
});
