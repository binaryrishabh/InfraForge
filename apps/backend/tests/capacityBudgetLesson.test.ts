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
import { splitTheCapacityBudget } from "../learning/content/architecture/lessons/split-the-capacity-budget";

test("capacity budget: canonical advanced module has existing prerequisites, an exact review and honest report labels", () => {
  const d = definition("split-the-capacity-budget"), lesson = capacityBudgetsLessons[0]!;
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(checkLearningAuthoring(learningContent).labs).toBeGreaterThan(0);
  expect(track.modules).toContainEqual(capacityBudgets);
  expect(capacityBudgets.lessonIds).toEqual([d.id]);
  expect(LEARNING_REGISTRY.findLesson(d.id)).toEqual(lesson);
  expect(lesson).toMatchObject({contentVersion: 2, level: "advanced", kind: "executable-lab", check: null, availability: "available", experiment: {challengeId: d.id}});
  expect(lesson.prerequisites.every(id => LEARNING_REGISTRY.findLesson(id) !== null)).toBe(true);
  expect(lesson.prerequisites).toContain("cache-or-database");
  expect(lesson.limitations.join(" ")).toContain("catalog snapshot figures, not a quote");
  expect(lesson.limitations.join(" ")).toContain("capacity numbers");
  for (const version of [1, 2]) expect(REVIEWED_CHALLENGES[`${d.id}@${version}`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
  expect(checkLessonClaims(lesson, d)).toEqual([]);
  const reviews = {...REVIEWED_CHALLENGES}; delete reviews[`${d.id}@2`];
  expect(() => checkLearningAuthoring(learningContent, reviews)).toThrow(`${d.id}@2: missing challenge review`);
  const changed = {...REVIEWED_CHALLENGES, [`${d.id}@2`]: {challengeId: d.id, version: 1, hash: "0".repeat(64)}};
  expect(() => checkLearningAuthoring(learningContent, changed)).toThrow("reviewed challenge identity is unavailable or changed");
  for (const label of ["Monthly SKU line items", "Per-resource monthly cost", "Remaining monthly budget"]) {
    expect(learningMeasurement(label)).toBeNull();
    const bad = structuredClone(lesson); bad.experiment!.evidenceToInspect = [label];
    expect(checkLessonClaims(bad, d)).toContain(`${d.id}@2: report does not render measurement ${label}`);
  }
});

test("budget lesson v2 describes saved prices while published v1 and its review remain resolvable", () => {
  const id = "split-the-capacity-budget", current = LEARNING_REGISTRY.findLesson(id)!;
  expect(current.contentVersion).toBe(2);
  expect(current.explanation.join(" ")).toContain("Monthly resource price line items and Remaining monthly budget");
  expect(current.limitations.join(" ")).toContain("Missing or invalid line items remain Unknown");
  expect(current.limitations.join(" ")).not.toContain("omits individual SKU prices");
  expect(LEARNING_REGISTRY.findLesson(id, 1)).toEqual(splitTheCapacityBudget);
  expect(LEARNING_REGISTRY.findLesson(id, 1)!.limitations.join(" ")).toContain("omits individual SKU prices");
  expect(learningContent.archivedLessons).toContainEqual(splitTheCapacityBudget);
  expect(LEARNING_REGISTRY.listLessons().filter(l => l.id === id).map(l => l.contentVersion)).toEqual([2]);
  const noOldReview = {...REVIEWED_CHALLENGES}; delete noOldReview[`${id}@1`];
  expect(() => checkLearningAuthoring(learningContent, noOldReview)).toThrow(`${id}@1: missing challenge review`);
});
