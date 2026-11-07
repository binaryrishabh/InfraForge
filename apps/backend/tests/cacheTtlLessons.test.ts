import { expect, test } from "bun:test";
import { learningContent } from "../learning/content";
import { cacheLifetime, cacheLifetimeLessons } from "../learning/content/data/cache-lifetime";
import { checkLearningAuthoring } from "../learning/authoring";
import { validateLearningContent } from "../learning/validate";
import { LEARNING_REGISTRY } from "../learning/registry";
import { definition, REFERENCE } from "./challengeHarness";

test("TTL lesson uses canonical data module, existing concepts, reviewed challenge and saved measurements", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  const lesson = cacheLifetimeLessons[0]!;
  expect(LEARNING_REGISTRY.findTrack("data")!.modules).toContainEqual(cacheLifetime);
  expect(LEARNING_REGISTRY.listLessons({trackId: "data", moduleId: cacheLifetime.id})).toEqual([lesson]);
  expect(cacheLifetime.lessonIds).toEqual([lesson.id]);
  expect(lesson).toMatchObject({kind: "executable-lab", level: "beginner", contentVersion: 2, availability: "available", check: null});
  expect(lesson.prerequisites.every(id => LEARNING_REGISTRY.findLesson(id)?.kind !== "executable-lab")).toBe(true);
  expect(lesson.prerequisites.every(id => LEARNING_REGISTRY.findLesson(id))).toBe(true);
  expect(lesson.limitations).toHaveLength(3); expect(lesson.followUp).toBeTruthy();
  expect(lesson.experiment!.evidenceToInspect!.length).toBeGreaterThan(1);
  expect(definition(lesson.id)).toMatchObject({engine: "2", version: 1, difficulty: "core"});
  expect(definition(lesson.id).hints).toHaveLength(3); expect(REFERENCE[lesson.id]).toBeDefined();
  const scoped = {tracks: [{...LEARNING_REGISTRY.findTrack("data")!, modules: [cacheLifetime]}], lessons: [{...lesson, prerequisites: []}]};
  expect(checkLearningAuthoring(scoped)).toMatchObject({labs: 1});
  expect(() => checkLearningAuthoring(scoped, {})).toThrow("missing challenge review");
});
