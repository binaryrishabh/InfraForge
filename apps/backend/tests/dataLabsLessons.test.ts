import { expect, test } from "bun:test";
import { tracks, lessons as registeredLessons } from "../learning/content";
import { track, lessons } from "../learning/content/data";
import { databasePressure } from "../learning/content/data/database-pressure";
import { latestChallenge } from "../challenges/registry";
import { REFERENCE } from "./challengeHarness";

test("data track registers three executable lessons with calibrated challenges and honest evidence limits", () => {
  expect(tracks.filter(t => t.id === "data")).toEqual([track]);
  expect(track.modules).toEqual([databasePressure]);
  expect(registeredLessons.filter(l => l.trackId === "data")).toEqual(lessons);
  expect(databasePressure.lessonIds).toEqual(lessons.map(l => l.id));
  const labs = lessons.filter(lesson => lesson.kind === "executable-lab");
  expect(labs).toHaveLength(3);
  expect(new Set(registeredLessons.map(l => l.id)).size).toBe(registeredLessons.length);
  expect(new Set(tracks.map(t => t.id)).size).toBe(tracks.length);
  for (const lesson of labs) {
    expect(lesson).toMatchObject({trackId: "data", moduleId: "database-pressure", kind: "executable-lab", contentVersion: 1, availability: "available"});
    expect(lesson.prerequisites.every(id => registeredLessons.some(l => l.id === id))).toBe(true);
    expect(lesson.limitations.length).toBeGreaterThan(0);
    expect(lesson.limitations.every(text => text.trim().length > 0)).toBe(true);
    expect(lesson.followUp.trim().length).toBeGreaterThan(0);
    expect(lesson.experiment!.prediction.trim().length).toBeGreaterThan(0);
    expect(lesson.experiment!.evidenceToInspect.length).toBeGreaterThan(1);
    const challenge = latestChallenge(lesson.experiment!.challengeId)!.definition;
    expect(challenge.engine).toBe("2"); expect(challenge.version).toBe(1);
    expect(challenge.starter).not.toBeNull(); expect(REFERENCE[challenge.id]).toBeDefined();
    expect(challenge.hints).toHaveLength(3); expect(challenge.predictions.length).toBeGreaterThan(0);
    if (lesson.check) expect(lesson.check.choices.some(c => c.id === lesson.check!.correctChoiceId)).toBe(true);
  }
});
