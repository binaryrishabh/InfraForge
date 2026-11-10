import { expect, test } from "bun:test";
import { checkLearningAuthoring } from "../learning/authoring";
import { validateLearningContent } from "../learning/validate";
import { learningContent } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { specHash } from "../challenges/registry";
import { functionReuseLabFixture } from "./functionReuseLab.fixture";

test("warm function lesson has its own module, measured evidence and reviewed challenge identity", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(() => checkLearningAuthoring(learningContent)).not.toThrow();
  const lesson = LEARNING_REGISTRY.findLesson("keep-a-function-warm")!;
  expect(lesson).toMatchObject({kind: "executable-lab", moduleId: "function-retention", experiment: {challengeId: "keep-a-function-warm"}, check: null});
  expect(lesson.experiment!.evidenceToInspect).toContain("Cold starts; Warm starts; Idle instances expired");
  expect(lesson.explanation.join(" ")).toContain("Review exactly one change");
  expect(lesson.limitations.join(" ")).toContain("not a claim that a cloud provider exposes exact retention");
  expect(lesson.limitations.join(" ")).toContain("warm-instance cost");
  const {d} = functionReuseLabFixture();
  expect(REVIEWED_CHALLENGES["keep-a-function-warm@1"]).toEqual({challengeId: d.id, version: d.version, hash: specHash(d)});
});
