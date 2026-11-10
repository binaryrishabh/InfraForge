import { expect, test } from "bun:test";
import { checkLearningAuthoring } from "../learning/authoring";
import { validateLearningContent } from "../learning/validate";
import { checkLessonClaims } from "../learning/claims";
import { learningContent } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { specHash } from "../challenges/registry";
import { lbForwardingLabFixture } from "./lbForwardingLab.fixture";

test("forwarding lesson has its own module, real evidence and reviewed challenge identity", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(() => checkLearningAuthoring(learningContent)).not.toThrow();
  const lesson = LEARNING_REGISTRY.findLesson("open-the-forwarding-gate")!, {d} = lbForwardingLabFixture();
  expect(lesson).toMatchObject({kind: "executable-lab", trackId: "depth", moduleId: "lb-forwarding", experiment: {challengeId: d.id}, check: null});
  expect(LEARNING_REGISTRY.findModule("depth", "lb-forwarding")!.lessonIds).toEqual([d.id]);
  expect(lesson.prerequisites).toContain("response-time-and-throughput");
  expect(lesson.explanation.join(" ")).toContain("Review exactly one change");
  expect(lesson.limitations.join(" ")).toContain("not a universal tuning rule");
  expect(lesson.limitations.join(" ")).toContain("LB CPU and memory are Unknown");
  expect(checkLessonClaims(lesson, d)).toEqual([]);
  expect(REVIEWED_CHALLENGES[`${d.id}@1`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
});
