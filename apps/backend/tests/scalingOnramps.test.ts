import { expect, test } from "bun:test";
import { learningContent } from "../learning/content";
import { firstScalingChoicesLessons } from "../learning/content/scaling/first-scaling-choices";
import { LEARNING_REGISTRY, buildLearningRegistry } from "../learning/registry";
import { checkLearningAuthoring } from "../learning/authoring";
import { deriveLessonProgress } from "../learning/progress";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { latestChallenge } from "../challenges/registry";

test("scaling starts with a beginner reading and exercise, then retains its published lab ladder", () => {
  expect(() => checkLearningAuthoring(learningContent)).not.toThrow();
  const track = LEARNING_REGISTRY.findTrack("scaling")!;
  const ordered = track.modules.flatMap(m => m.lessonIds).map(id => LEARNING_REGISTRY.findLesson(id)!);
  expect(ordered.slice(0, 2)).toEqual(firstScalingChoicesLessons);
  expect(ordered.slice(0, 2).map(l => [l.level, l.kind])).toEqual([
    ["beginner", "reading"], ["beginner", "conceptual-exercise"],
  ]);
  expect(ordered.findIndex(l => l.level === "intermediate")).toBeGreaterThan(1);
  // These lessons cannot manufacture lab activity or an experiment from a reading/check.
  expect(deriveLessonProgress("reader", ordered.slice(0, 2), [])).toEqual([]);
  for (const lesson of ordered.slice(0, 2)) {
    expect(lesson.experiment).toBeNull();
    expect(lesson.limitations.join(" ")).toContain("Conceptual only");
    for (const id of lesson.prerequisites) expect(LEARNING_REGISTRY.findLesson(id)?.availability).toBe("available");
    const nextIds = [...lesson.followUp!.matchAll(/\(([a-z-]+)\)/g)].map(match => match[1]!);
    expect(nextIds.length).toBeGreaterThan(0);
    for (const id of nextIds) {
      const next = LEARNING_REGISTRY.findLesson(id)!;
      expect(next.availability).toBe("available");
      if (next.kind === "executable-lab") {
        const entry = latestChallenge(next.experiment.challengeId)!;
        expect(entry.definition.engine).toBe("2");
        expect(REVIEWED_CHALLENGES[`${next.id}@${next.contentVersion}`]).toEqual({
          challengeId: entry.definition.id, version: entry.definition.version, hash: entry.hash,
        });
      }
    }
  }
  expect(ordered.find(l => l.id === "retrying-a-full-pool")).toMatchObject({kind: "executable-lab", level: "advanced"});
  expect(ordered.filter(l => l.kind === "executable-lab").map(l => l.id)).toEqual([
    "route-around-a-slow-vm", "leave-room-for-a-burst", "retrying-a-full-pool",
  ]);
});

test("the conceptual check and authoring gate refuse invented results, experiments and broken next steps", () => {
  const exercise = LEARNING_REGISTRY.findLesson("choose-the-constrained-tier")!;
  expect(exercise.check!.correctChoiceId).toBe("database");
  expect(exercise.check!.choices.find(c => c.id === "database")!.text).toContain("Keep arrivals and apps fixed");
  expect(exercise.check!.explanation).toContain("A different bottleneck may remain");
  for (const id of firstScalingChoicesLessons.map(l => l.id)) {
    for (const [mutate, reason] of [
      [(l: typeof exercise) => { l.explanation[0] = "The recorded run shows twice as many completions."; }, "non-executable lesson claims simulated results"],
      [(l: typeof exercise) => { l.prerequisites = ["invented-scaling-prerequisite"]; }, "missing prerequisite"],
      [(l: typeof exercise) => { Object.assign(l, {experiment: {challengeId: "leave-room-for-a-burst", prediction: null}}); }, "experiment"],
      [(l: typeof exercise) => { l.explanation[0] = "A recorded simulation completes 999 requests per second."; }, "digits-with-units result claim"],
    ] as const) {
      const content = structuredClone(learningContent);
      mutate(content.lessons.find(l => l.id === id)!);
      expect(() => checkLearningAuthoring(content)).toThrow(reason);
    }
  }
  const noCheck = structuredClone(learningContent);
  noCheck.lessons.find(l => l.id === exercise.id)!.check = null;
  expect(() => buildLearningRegistry(noCheck)).toThrow("check");
  const invalidAnswer = structuredClone(learningContent);
  invalidAnswer.lessons.find(l => l.id === exercise.id)!.check!.correctChoiceId = "missing";
  expect(() => buildLearningRegistry(invalidAnswer)).toThrow("invalid correctChoiceId");
});
