import { expect, test } from "bun:test";
import { learningContent } from "../learning/content";
import { lessons, track } from "../learning/content/depth";
import { resourcePressureLessons } from "../learning/content/depth/resource-pressure";
import { validateLearningContent } from "../learning/validate";
import { LEARNING_REGISTRY } from "../learning/registry";
import { checkLearningAuthoring } from "../learning/authoring";
import { definition } from "./challengeHarness";

test("depth lessons use canonical shapes, resolve prerequisites and register three runnable experiments", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(resourcePressureLessons).toHaveLength(3);
  expect(LEARNING_REGISTRY.findTrack("depth")).toEqual(track);
  for (const lesson of resourcePressureLessons) {
    expect(LEARNING_REGISTRY.findLesson(lesson.id)).toEqual(lesson);
    expect(lesson.kind).toBe("executable-lab"); expect(lesson.check).toBeNull();
    expect(lesson.limitations.length).toBeGreaterThan(0);
    for (const prerequisite of lesson.prerequisites) expect(LEARNING_REGISTRY.findLesson(prerequisite)).not.toBeNull();
    expect(lesson.experiment!.challengeId).toBe(lesson.id);
    expect(lesson.experiment!.evidenceToInspect!.length).toBeGreaterThan(1);
    expect(definition(lesson.id).difficulty).toBe(lesson.level === "advanced" ? "advanced" : "core");
  }
  const broken = structuredClone(learningContent);
  broken.lessons.find(l => l.id === lessons[0]!.id)!.limitations = [];
  expect(validateLearningContent(broken).join("\n")).toContain("limitations");
});

test("depth labs pass the authoring gate only through a recorded review, and not without one", () => {
  const content = {tracks: [track], lessons: lessons.map(l => ({...l, prerequisites: []})), archivedLessons: []};
  // Without any review record the gate must refuse; the coordinator records reviews in reviewedChallenges.ts.
  expect(() => checkLearningAuthoring(content, {})).toThrow("missing challenge review; needs a human look");
  expect(() => checkLearningAuthoring(content)).not.toThrow();
});
