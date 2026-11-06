import { expect, test } from "bun:test";
import { learningContent } from "../learning/content";
import { lessons, track } from "../learning/content/architecture";
import { validateLearningContent } from "../learning/validate";
import { checkLearningAuthoring } from "../learning/authoring";
import { LEARNING_REGISTRY } from "../learning/registry";
import { definition, REFERENCE } from "./challengeHarness";

test("architecture registers three canonical core labs with earlier concepts and labs", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(lessons).toHaveLength(3); expect(LEARNING_REGISTRY.findTrack("architecture")).toEqual(track);
  expect(LEARNING_REGISTRY.listLessons({trackId: "architecture"})).toEqual(lessons);
  expect(track.modules[0]!.lessonIds).toEqual(lessons.map(l => l.id));
  for (const lesson of lessons) {
    expect(lesson).toMatchObject({contentVersion: 1, kind: "executable-lab", level: "intermediate", availability: "available", check: null});
    const earlier = lesson.prerequisites.map(id => LEARNING_REGISTRY.findLesson(id)!);
    expect(earlier.some(l => l.kind === "executable-lab")).toBe(true);
    expect(earlier.some(l => l.kind !== "executable-lab")).toBe(true);
    expect(earlier.every(l => l.trackId !== "architecture")).toBe(true);
    expect(lesson.limitations.length).toBeGreaterThan(1); expect(lesson.experiment!.evidenceToInspect!.length).toBeGreaterThan(1);
    expect(lesson.followUp).toBeTruthy(); expect(lesson.experiment!.challengeId).toBe(lesson.id);
    expect(definition(lesson.id)).toMatchObject({difficulty: "core", engine: "2", version: 1});
    expect(REFERENCE[lesson.id]).toBeDefined(); expect(definition(lesson.id).hints).toHaveLength(3);
  }
  const scoped = {tracks: [track], lessons: lessons.map(l => ({...l, prerequisites: []}))};
  expect(checkLearningAuthoring(scoped)).toMatchObject({labs: 3});
  expect(() => checkLearningAuthoring(scoped, {})).toThrow("missing challenge review");
});
