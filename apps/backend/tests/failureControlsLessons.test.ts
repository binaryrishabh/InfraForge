import { expect, test } from "bun:test";
import { learningContent } from "../learning/content";
import { failureControlLessons, failureControls } from "../learning/content/depth/failure-controls";
import { track, lessons } from "../learning/content/depth";
import { checkLearningAuthoring } from "../learning/authoring";
import { validateLearningContent } from "../learning/validate";
import { LEARNING_REGISTRY } from "../learning/registry";
import { LEARNING_REPORT_MEASUREMENTS, evidenceLabels } from "@infraforge/contracts/learning";
import { definition, REFERENCE } from "./challengeHarness";

test("failure controls register six honest concepts and one reviewed lab without treating absent measurements as saved proof", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(checkLearningAuthoring(learningContent)).toMatchObject({tracks: 9});
  expect(track.modules.find(m => m.id === failureControls.id)).toEqual(failureControls);
  expect(failureControls.lessonIds).toEqual(failureControlLessons.map(l => l.id));
  expect(LEARNING_REGISTRY.listLessons({trackId: "depth"})).toEqual(lessons);
  expect(failureControlLessons.filter(l => l.kind !== "executable-lab")).toHaveLength(6);
  for (const lesson of failureControlLessons) {
    expect(LEARNING_REGISTRY.findLesson(lesson.id)).toEqual(lesson);
    expect(lesson.prerequisites.every(id => LEARNING_REGISTRY.findLesson(id))).toBe(true);
    expect(lesson.limitations.every(s => s.trim().length > 0)).toBe(true);
    if (lesson.kind !== "executable-lab") expect(lesson.experiment).toBeNull();
  }
  const lab = failureControlLessons.find(l => l.kind === "executable-lab")!;
  expect(lab).toMatchObject({id: "share-a-cache-fill", level: "advanced", check: null});
  const d = definition(lab.experiment!.challengeId);
  expect(d).toMatchObject({engine: "2", version: 1, difficulty: "advanced"});
  expect(d.hints).toHaveLength(3); expect(REFERENCE[d.id]).toBeDefined();
  for (const label of lab.experiment!.evidenceToInspect!.flatMap(evidenceLabels)) {
    expect(Object.hasOwn(LEARNING_REPORT_MEASUREMENTS, label)).toBe(true);
  }
  const paths = Object.values(LEARNING_REPORT_MEASUREMENTS).map(m => m.path);
  expect(paths.some(p => /coalescedWaiters|circuitBreaker|clientRetry|suppressedByReason/.test(p))).toBe(false);

  const missingReview = {...learningContent, lessons: [lab], tracks: [{...track, modules: [{...failureControls, lessonIds: [lab.id]}]}]};
  missingReview.lessons = [{...lab, prerequisites: []}];
  expect(() => checkLearningAuthoring(missingReview, {})).toThrow("missing challenge review");
  const missingLimits = structuredClone(learningContent);
  missingLimits.lessons.find(l => l.id === "timeout-ownership")!.limitations = [];
  expect(validateLearningContent(missingLimits).join("\n")).toContain("limitations");
  const fabricated = structuredClone(learningContent);
  fabricated.lessons.find(l => l.id === lab.id)!.experiment!.evidenceToInspect = ["Circuit breaker state"];
  expect(() => checkLearningAuthoring(fabricated)).toThrow("report does not render measurement");
});
