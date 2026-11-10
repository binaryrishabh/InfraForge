import { expect, test } from "bun:test";
import { checkLearningAuthoring } from "../learning/authoring";
import { validateLearningContent } from "../learning/validate";
import { checkLessonClaims } from "../learning/claims";
import { learningContent } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { specHash } from "../challenges/registry";
import { cpuBudgetLabFixture } from "./cpuBudgetLab.fixture";

test("CPU budget lesson has its own module, retained evidence and reviewed identity", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(() => checkLearningAuthoring(learningContent)).not.toThrow();
  const lesson = LEARNING_REGISTRY.findLesson("release-the-cpu-budget")!, {d} = cpuBudgetLabFixture();
  expect(lesson).toMatchObject({kind: "executable-lab", trackId: "depth", moduleId: "cpu-budget", experiment: {challengeId: d.id}, check: null});
  expect(LEARNING_REGISTRY.findModule("depth", "cpu-budget")!.lessonIds).toEqual([d.id]);
  expect(lesson.prerequisites).toContain("response-time-and-throughput");
  expect(lesson.explanation.join(" ")).toContain("Review exactly one change");
  expect(lesson.limitations.join(" ")).toContain("not saved report measurements");
  expect(lesson.limitations.join(" ")).toContain("Memory remains Unknown");
  expect(checkLessonClaims(lesson, d)).toEqual([]);
  expect(REVIEWED_CHALLENGES[`${d.id}@1`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
});
