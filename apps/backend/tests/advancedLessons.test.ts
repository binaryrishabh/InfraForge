import { expect, test } from "bun:test";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { learningContent } from "../learning/content";
import { lessons, track } from "../learning/content/advanced";
import { validateLearningContent } from "../learning/validate";
import { LEARNING_REGISTRY } from "../learning/registry";
import { checkLearningAuthoring } from "../learning/authoring";
import { definition, REFERENCE } from "./challengeHarness";

test("advanced practice registers four canonical runnable lessons with concept and earlier lab prerequisites and explicit limits", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(lessons).toHaveLength(4); expect(LEARNING_REGISTRY.findTrack("advanced")).toEqual(track);
  expect(track.modules).toHaveLength(1); expect(track.modules[0]!.lessonIds).toEqual(lessons.map(l => l.id));
  expect(LEARNING_REGISTRY.listLessons({trackId: "advanced"})).toEqual(lessons);
  for (const lesson of lessons) {
    expect(LEARNING_REGISTRY.findLesson(lesson.id)).toEqual(lesson);
    expect(lesson).toMatchObject({contentVersion: 1, kind: "executable-lab", level: "advanced", availability: "available", check: null});
    expect(lesson.prerequisites.length).toBeGreaterThan(0);
    const prerequisites = lesson.prerequisites.map(id => LEARNING_REGISTRY.findLesson(id)!);
    expect(prerequisites.some(l => l.kind !== "executable-lab")).toBe(true);
    expect(prerequisites.some(l => l.kind === "executable-lab")).toBe(true);
    for (const earlier of prerequisites) expect(earlier.trackId).not.toBe("advanced");
    expect(lesson.limitations.length).toBeGreaterThan(1); expect(lesson.followUp!.trim().length).toBeGreaterThan(0);
    expect(lesson.experiment!.challengeId).toBe(lesson.id); expect(lesson.experiment!.evidenceToInspect!.length).toBeGreaterThan(1);
    const d = definition(lesson.id);
    expect(d).toMatchObject({difficulty: "advanced", engine: "2", version: 1});
    expect(validateInfrastructureName(d.title)).toBeNull();
    expect(d.hints).toHaveLength(3); expect(REFERENCE[d.id]).toBeDefined();
  }
  const bad = structuredClone(learningContent); bad.lessons.find(l => l.id === lessons[0]!.id)!.limitations = [];
  expect(validateLearningContent(bad).join("\n")).toContain("limitations");
});

test("advanced content preserves the human challenge-review refusal without inventing receipts", () => {
  const content = {tracks: [track], lessons: lessons.map(l => ({...l, prerequisites: []})), archivedLessons: []};
  expect(() => checkLearningAuthoring(content, {})).toThrow("missing challenge review; needs a human look");
  expect(checkLearningAuthoring(content)).toMatchObject({labs: 4});
});
