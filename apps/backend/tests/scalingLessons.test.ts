import { expect, test } from "bun:test";
import { tracks, lessons as registeredLessons } from "../learning/content";
import { track, lessons } from "../learning/content/scaling";
import { servingUnderLoad } from "../learning/content/scaling/serving-under-load";
import { firstScalingChoices, firstScalingChoicesLessons } from "../learning/content/scaling/first-scaling-choices";
import { scalingReasoning } from "../learning/content/scaling/scaling-reasoning";
import { latestChallenge } from "../challenges/registry";
import { REFERENCE } from "./challengeHarness";

test("scaling registers three executable labs with real challenges, limitations and measured evidence", () => {
  expect(tracks.filter(t => t.id === "scaling")).toEqual([track]);
  expect(track.modules.slice(0, 3)).toEqual([firstScalingChoices, servingUnderLoad, scalingReasoning]); // Later lanes append modules.
  expect(registeredLessons.filter(l => l.trackId === "scaling")).toEqual(lessons);
  expect(track.modules.flatMap(m => m.lessonIds)).toEqual(lessons.map(l => l.id)); // Later lanes append modules and lessons.
  expect([...firstScalingChoices.lessonIds, ...servingUnderLoad.lessonIds, ...scalingReasoning.lessonIds].every(id => lessons.some(l => l.id === id))).toBe(true);
  expect(firstScalingChoicesLessons.map(l => l.kind)).toEqual(["reading", "conceptual-exercise"]);
  const labs = lessons.filter(lesson => lesson.kind === "executable-lab");
  expect(labs).toHaveLength(3);
  expect(new Set(registeredLessons.map(l => l.id)).size).toBe(registeredLessons.length);
  expect(new Set(tracks.map(t => t.id)).size).toBe(tracks.length);
  for (const lesson of labs) {
    expect(lesson).toMatchObject({trackId: "scaling", moduleId: "serving-under-load", kind: "executable-lab", contentVersion: 1, availability: "available"});
    expect(lesson.prerequisites.every(id => registeredLessons.some(l => l.id === id))).toBe(true);
    expect(lesson.limitations.length).toBeGreaterThan(0);
    expect(lesson.limitations.every(text => text.trim().length > 0)).toBe(true);
    expect((lesson.followUp?.trim().length ?? 0)).toBeGreaterThan(0);
    expect((lesson.experiment?.prediction?.trim().length ?? 0)).toBeGreaterThan(0);
    expect((lesson.experiment?.evidenceToInspect?.length ?? 0)).toBeGreaterThan(1);
    const challenge = latestChallenge(lesson.experiment!.challengeId)!.definition;
    expect(challenge.engine).toBe("2");
    expect(challenge.starter).not.toBeNull();
    expect(REFERENCE[challenge.id]).toBeDefined();
    expect(challenge.hints).toHaveLength(3);
    expect(challenge.predictions.length).toBeGreaterThan(0);
    if (lesson.check) expect(lesson.check.choices.some(c => c.id === lesson.check!.correctChoiceId)).toBe(true);
  }
});
