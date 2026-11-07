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
import { splitTheCapacityBudgetV2 } from "../learning/content/architecture/lessons/split-the-capacity-budget-v2";

test("capacity budget: canonical advanced module has existing prerequisites, an exact review and honest report labels", () => {
  const d = definition("split-the-capacity-budget"), lesson = capacityBudgetsLessons[0]!;
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(checkLearningAuthoring(learningContent).labs).toBeGreaterThan(0);
  expect(track.modules).toContainEqual(capacityBudgets);
  expect(capacityBudgets.lessonIds).toEqual([d.id]);
  expect(LEARNING_REGISTRY.findLesson(d.id)).toEqual(lesson);
  expect(lesson).toMatchObject({contentVersion: 3, level: "advanced", kind: "executable-lab", check: null, availability: "available", experiment: {challengeId: d.id}});
  expect(lesson.prerequisites.every(id => LEARNING_REGISTRY.findLesson(id) !== null)).toBe(true);
  expect(lesson.prerequisites).toContain("cache-or-database");
  expect(lesson.limitations.join(" ")).toContain("catalog snapshot figures, not a quote");
  expect(lesson.limitations.join(" ")).toContain("capacity numbers");
  for (const version of [1, 2, 3]) expect(REVIEWED_CHALLENGES[`${d.id}@${version}`]).toEqual({challengeId: d.id, version: 1, hash: specHash(d)});
  expect(checkLessonClaims(lesson, d)).toEqual([]);
  const reviews = {...REVIEWED_CHALLENGES}; delete reviews[`${d.id}@3`];
  expect(() => checkLearningAuthoring(learningContent, reviews)).toThrow(`${d.id}@3: missing challenge review`);
  const changed = {...REVIEWED_CHALLENGES, [`${d.id}@3`]: {challengeId: d.id, version: 1, hash: "0".repeat(64)}};
  expect(() => checkLearningAuthoring(learningContent, changed)).toThrow("reviewed challenge identity is unavailable or changed");
  for (const label of ["Monthly SKU line items", "Per-resource monthly cost", "Invented remaining budget"]) {
    expect(learningMeasurement(label)).toBeNull();
    const bad = structuredClone(lesson); bad.experiment!.evidenceToInspect = [label];
    expect(checkLessonClaims(bad, d)).toContain(`${d.id}@3: report does not render measurement ${label}`);
  }
});

test("budget lesson v3 names saved cost evidence while both published versions remain resolvable", () => {
  const id = "split-the-capacity-budget", current = LEARNING_REGISTRY.findLesson(id)!;
  expect(current.contentVersion).toBe(3);
  expect(current.explanation.join(" ")).toContain("Monthly resource price line items and Remaining monthly budget");
  expect(current.limitations.join(" ")).toContain("Missing or invalid line items remain Unknown");
  expect(current.limitations.join(" ")).not.toContain("omits individual SKU prices");
  expect(LEARNING_REGISTRY.findLesson(id, 1)).toEqual(splitTheCapacityBudget);
  expect(LEARNING_REGISTRY.findLesson(id, 1)!.limitations.join(" ")).toContain("omits individual SKU prices");
  expect(learningContent.archivedLessons).toContainEqual(splitTheCapacityBudget);
  expect(LEARNING_REGISTRY.findLesson(id, 2)).toEqual(splitTheCapacityBudgetV2);
  expect(learningContent.archivedLessons).toContainEqual(splitTheCapacityBudgetV2);
  expect(current.experiment!.evidenceToInspect!.join("; ")).toContain("Monthly resource price line items; Remaining monthly budget");
  expect(splitTheCapacityBudgetV2.experiment!.evidenceToInspect!.join("; ")).not.toContain("Remaining monthly budget");
  expect(LEARNING_REGISTRY.listLessons().filter(l => l.id === id).map(l => l.contentVersion)).toEqual([3]);
  const noOldReview = {...REVIEWED_CHALLENGES}; delete noOldReview[`${id}@1`];
  expect(() => checkLearningAuthoring(learningContent, noOldReview)).toThrow(`${id}@1: missing challenge review`);
});

test("cost labels are audited and refuse lessons whose report has no reviewed monthly budget", () => {
  const d = definition("split-the-capacity-budget"), lesson = structuredClone(capacityBudgetsLessons[0]!);
  for (const [label, path] of [["Monthly resource price line items", "lineItems.*.monthlyUsd"],
    ["Remaining monthly budget", "monthlyBudgets.*.remainingUsd"]]) {
    expect(learningMeasurement(label!)).toMatchObject({scope: "monthly", path, unit: "USD",
      source: "apps/web/src/features/reports/components/ReportMeasurements.tsx", marker: label});
    lesson.experiment!.evidenceToInspect = [label!];
    expect(checkLessonClaims(lesson, d)).toEqual([]);
    const noBudget = {...d, criteria: d.criteria.filter(c => c.kind !== "monthly-budget")};
    expect(checkLessonClaims(lesson, noBudget).join("\n")).toContain(`report does not render measurement ${label} without a monthly-budget requirement`);
  }
});
