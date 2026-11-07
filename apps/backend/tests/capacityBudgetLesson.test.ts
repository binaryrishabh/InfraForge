import { expect, test } from "bun:test";
import { learningMeasurement } from "@infraforge/contracts/learning";
import { learningContent } from "../learning/content";
import { track } from "../learning/content/architecture";
import { capacityBudgets, capacityBudgetsLessons } from "../learning/content/architecture/capacity-budgets";
import { checkLearningAuthoring } from "../learning/authoring";
import { checkLessonClaims } from "../learning/claims";
import { validateLearningContent } from "../learning/validate";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { specHash } from "../challenges/registry";
import { definition } from "./challengeHarness";

test("capacity budget: canonical advanced module has existing prerequisites, an exact review and honest report labels", () => {
  const d = definition("split-the-capacity-budget"), lesson = capacityBudgetsLessons[0]!;
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(checkLearningAuthoring(learningContent).labs).toBeGreaterThan(0);
  expect(track.modules).toContainEqual(capacityBudgets);
  expect(capacityBudgets.lessonIds).toEqual([d.id]);
  expect(LEARNING_REGISTRY.findLesson(d.id)).toEqual(lesson);
  expect(lesson).toMatchObject({contentVersion: 1, level: "advanced", kind: "executable-lab", check: null, availability: "available", experiment: {challengeId: d.id}});
  expect(lesson.prerequisites.every(id => LEARNING_REGISTRY.findLesson(id) !== null)).toBe(true);
  expect(lesson.prerequisites).toContain("cache-or-database");
  expect(lesson.limitations.join(" ")).toContain("catalog snapshot figures, not a quote");
  expect(lesson.limitations.join(" ")).toContain("capacity numbers");
  expect(REVIEWED_CHALLENGES[`${d.id}@1`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
  expect(checkLessonClaims(lesson, d)).toEqual([]);
  const reviews = {...REVIEWED_CHALLENGES}; delete reviews[`${d.id}@1`];
  expect(() => checkLearningAuthoring(learningContent, reviews)).toThrow(`${d.id}@1: missing challenge review`);
  const changed = {...REVIEWED_CHALLENGES, [`${d.id}@1`]: {challengeId: d.id, version: 1, hash: "0".repeat(64)}};
  expect(() => checkLearningAuthoring(learningContent, changed)).toThrow("reviewed challenge identity is unavailable or changed");
  for (const label of ["Monthly SKU line items", "Per-resource monthly cost", "Remaining monthly budget"]) {
    expect(learningMeasurement(label)).toBeNull();
    const bad = structuredClone(lesson); bad.experiment!.evidenceToInspect = [label];
    expect(checkLessonClaims(bad, d)).toContain(`${d.id}@1: report does not render measurement ${label}`);
  }
});
