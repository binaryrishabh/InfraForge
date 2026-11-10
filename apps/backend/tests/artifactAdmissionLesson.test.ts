import { expect, test } from "bun:test";
import { findLearningLesson, LEARNING_REGISTRY } from "../learning/registry";
import { learningContent } from "../learning/content";
import { validateLearningContent } from "../learning/validate";
import { checkLessonClaims } from "../learning/claims";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { specHash } from "../challenges/registry";
import { artifactAdmissionLabFixture } from "./artifactAdmissionLab.fixture";

test("the artifact admission lab has its own reviewed module and honest saved-evidence lesson", () => {
  const {d} = artifactAdmissionLabFixture(), lesson = findLearningLesson(d.id)!;
  expect(lesson).toMatchObject({kind: "executable-lab", trackId: "scaling", moduleId: "artifact-admission", experiment: {challengeId: d.id}, check: null});
  expect(LEARNING_REGISTRY.findModule("scaling", "artifact-admission")!.lessonIds).toEqual([d.id]);
  expect(REVIEWED_CHALLENGES[`${lesson.id}@1`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
  expect(validateLearningContent(learningContent)).toEqual([]); expect(checkLessonClaims(lesson, d)).toEqual([]);
  expect(lesson.limitations.join(" ")).toContain("no caller throughput improvement");
  expect(lesson.limitations.join(" ")).toContain("Missing times and omitted evidence stay Unknown");
  expect(lesson.explanation.join(" ")).toContain("diagnosis");
  expect(lesson.followUp).toContain("Maximum-only near miss");
});
