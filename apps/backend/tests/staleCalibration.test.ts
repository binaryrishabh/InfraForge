import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { captureRunInputs } from "../deployments/runInputs";
import { reviewDesignChanges } from "../challenges/designChanges";
import { preflight } from "../challenges/preflight";
import { challengeSeed, specHash } from "../challenges/registry";
import { improvementSource } from "../challenges/improvements";
import { buildRunReport } from "../reports/report";
import { staleLabFixture } from "./staleLab.fixture";

const num = (t: string, re: RegExp) => Number(re.exec(t)![1]);
test("stale reads: one delay edit bounds staleness; a primary-only near miss fails capacity", () => {
  const {d, designs, rows} = staleLabFixture(), reports = rows.map(r => buildRunReport(r));
  expect(validateInfrastructureName(d.title)).toBeNull();
  expect(specHash(d)).toBe(/"bound-replica-staleness@1": "([a-f0-9]{64})"/.exec(readFileSync(new URL("./challengeAuthoring.test.ts", import.meta.url), "utf8"))![1]!);
  const inputs = designs.map(s => captureRunInputs(s, d.workload, challengeSeed(d)));
  for (const s of designs) expect(preflight(d, s).errors).toEqual([]);
  for (const i of [1, 2]) expect(reviewDesignChanges(inputs[0]!, inputs[i]!)).toMatchObject({classification: "one-change", count: 1});
  expect(reviewDesignChanges(inputs[0]!, inputs[1]!).differences!.reconfigured[0]!.fields[0]!.field).toContain("databaseReplication");
  expect(reports.map(r => r.challenge!.status)).toEqual(["not-met", "met", "not-met"]);
  const stale = reports.map(r => num(r.challenge!.criteria.find(c => c.id === "fresh")!.detail, /served (\d+) stale/));
  const lat = reports.map(r => num(r.challenge!.criteria.find(c => c.id === "latency")!.detail, /p95 was ([\d.]+) ms/));
  expect(stale[0]!).toBeGreaterThan(4000); expect(stale[1]!).toBeLessThan(200); expect(stale[2]!).toBe(0);
  expect(lat[0]!).toBeLessThan(20); expect(lat[1]!).toBeLessThan(20); expect(lat[2]!).toBeGreaterThan(1000);
  for (const [i, row] of rows.entries()) {
    const replayed = buildRunReport({...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot))});
    expect(replayed.terminal).toEqual(reports[i]!.terminal); expect(replayed.challenge).toEqual(reports[i]!.challenge);
    expect(reports[i]!.challenge!.predictions[0]).toMatchObject({predicted: "healthy", actual: "healthy", outcome: "matched"});
  }
  expect(improvementSource(rows[0]!, d.id).input).toEqual(inputs[0]!);
  console.info("shed-load-calibration", JSON.stringify({lat, stale}));
}, 120000);

test("lesson is registered in its own module with limitations and the pinned review record", async () => {
  const { findLearningLesson, LEARNING_REGISTRY } = await import("../learning/registry");
  const { learningContent } = await import("../learning/content"), { validateLearningContent } = await import("../learning/validate");
  const { checkLessonClaims } = await import("../learning/claims"), { REVIEWED_CHALLENGES } = await import("../learning/reviewedChallenges");
  const {d} = staleLabFixture(), lesson = findLearningLesson(d.id)!;
  expect(lesson).toMatchObject({kind: "executable-lab", trackId: "data", moduleId: "replica-freshness", experiment: {challengeId: d.id}, check: null});
  expect(LEARNING_REGISTRY.findModule("data", "replica-freshness")!.lessonIds).toEqual([d.id]);
  expect(REVIEWED_CHALLENGES[`${lesson.id}@1`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
  expect(validateLearningContent(learningContent)).toEqual([]); expect(checkLessonClaims(lesson, d)).toEqual([]);
  expect(lesson.limitations.join(" ")).toContain("no application consistency");
});
