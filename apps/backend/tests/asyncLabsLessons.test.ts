import { expect, test } from "bun:test";
import { tracks, lessons as registeredLessons } from "../learning/content";
import { track, lessons } from "../learning/content/async";
import { queuedWork, queuedWorkLessons } from "../learning/content/async/queued-work";
import { firstQueue } from "../learning/content/async/first-queue";
import { burstWorkers } from "../learning/content/async/burst-workers";
import { asyncReasoning } from "../learning/content/async/async-reasoning";
import { latestChallenge } from "../challenges/registry";
import { REFERENCE } from "./challengeHarness";

test("async queued-work module retains three executable lessons with calibrated challenges and honest limitations", () => {
  expect(tracks.filter(t => t.id === "async")).toEqual([track]);
  expect(track.modules.slice(0, 4)).toEqual([firstQueue, queuedWork, burstWorkers, asyncReasoning]); // Later labs append modules.
  expect(registeredLessons.filter(l => l.trackId === "async")).toEqual(lessons);
  expect(queuedWork.lessonIds).toEqual(queuedWorkLessons.map(l => l.id));
  const labs = queuedWorkLessons.filter(lesson => lesson.kind === "executable-lab");
  expect(labs).toHaveLength(3);
  expect(new Set(registeredLessons.map(l => l.id)).size).toBe(registeredLessons.length);
  expect(new Set(tracks.map(t => t.id)).size).toBe(tracks.length);
  for (const lesson of labs) {
    expect(lesson.contentVersion).toBeGreaterThanOrEqual(1);
    expect(lesson).toMatchObject({trackId: "async", moduleId: "queued-work", kind: "executable-lab", availability: "available"});
    expect(lesson.prerequisites.every(id => registeredLessons.some(l => l.id === id))).toBe(true);
    expect(lesson.limitations.length).toBeGreaterThan(0); expect(lesson.limitations.every(text => text.trim().length > 0)).toBe(true);
    expect((lesson.followUp?.trim().length ?? 0)).toBeGreaterThan(0); expect((lesson.experiment?.prediction?.trim().length ?? 0)).toBeGreaterThan(0);
    expect((lesson.experiment?.evidenceToInspect?.length ?? 0)).toBeGreaterThan(1);
    const challenge = latestChallenge(lesson.experiment!.challengeId)!.definition;
    expect(challenge.engine).toBe("2"); expect(challenge.version).toBeGreaterThanOrEqual(1); expect(challenge.starter).not.toBeNull(); expect(REFERENCE[challenge.id]).toBeDefined();
    expect(challenge.hints).toHaveLength(3); expect(challenge.predictions.length).toBeGreaterThan(0);
    expect(challenge.criteria.some(c => c.kind === "queue-work")).toBe(true);
    if (lesson.check) expect(lesson.check.choices.some(c => c.id === lesson.check!.correctChoiceId)).toBe(true);
  }
});
