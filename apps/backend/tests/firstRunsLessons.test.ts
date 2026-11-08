import { expect, test } from "bun:test";
import { tracks, lessons as allLessons } from "../learning/content";
import { firstRuns } from "../learning/content/foundations/first-runs";
import { latestChallenge } from "../challenges/registry";
import { REFERENCE } from "./challengeHarness";

const lessons = allLessons.filter(l => l.moduleId === "first-runs");

test("first-runs registers three typed executable labs linked to calibrated Model 2 challenges", () => {
  expect(tracks.find(t => t.id === "foundations")?.modules).toContainEqual(firstRuns);
  expect(lessons.map(l => l.id)).toEqual(firstRuns.lessonIds);
  expect(new Set(lessons.map(l => l.id)).size).toBeGreaterThanOrEqual(3); // Later lanes add first-run lessons.
  for (const lesson of lessons) {
    expect(lesson).toMatchObject({trackId: "foundations", moduleId: "first-runs", kind: "executable-lab", contentVersion: 1, availability: "available", level: "beginner"});
    expect(lesson.limitations.length).toBeGreaterThan(0);
    expect(lesson.limitations.every(s => s.trim().length > 0)).toBe(true);
    expect(lesson.experiment!.prediction!.length).toBeGreaterThan(0);
    expect(lesson.experiment!.evidenceToInspect!.length).toBeGreaterThan(0);
    const challenge = latestChallenge(lesson.experiment!.challengeId)!.definition;
    expect(challenge.engine).toBe("2");
    expect(challenge.starter).not.toBeNull();
    expect(REFERENCE[challenge.id]).toBeDefined();
    expect(challenge.hints).toHaveLength(3);
    expect(challenge.predictions.length).toBeGreaterThan(0);
    expect(lesson.followUp!.trim().length).toBeGreaterThan(0);
  }
});
