import { expect, test } from "bun:test";
import { learningContent } from "../learning/content";
import { firstQueue, firstQueueLessons } from "../learning/content/async/first-queue";
import { validateLearningContent } from "../learning/validate";
import { checkLearningAuthoring } from "../learning/authoring";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { latestChallenge } from "../challenges/registry";

test("beginner queue reading and exercise precede the retained first lab and link to real next lessons", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  expect(firstQueue.lessonIds).toEqual(["why-work-waits", "count-waiting-jobs", "keep-waiting-work"]);
  expect(firstQueueLessons.map(l => l.kind)).toEqual(["reading", "conceptual-exercise", "executable-lab"]);
  for (const [index, lesson] of firstQueueLessons.slice(0, 2).entries()) {
    expect(lesson.level).toBe("beginner"); expect(lesson.experiment).toBeNull();
    expect(lesson.limitations.join(" ")).toMatch(/not (simulated results|recorded simulator evidence)/);
    expect(lesson.explanation.join(" ")).toMatch(/[Aa]t-least-once/);
    expect(lesson.prerequisites.every(id => learningContent.lessons.some(l => l.id === id))).toBe(true);
    expect(lesson.followUp).toContain(`(${firstQueueLessons[index + 1]!.id})`);
  }
  const exercise = firstQueueLessons[1]!;
  expect(exercise.check!.correctChoiceId).toBe("gap");
  expect(exercise.check!.explanation).toContain("Forty arrivals minus twenty completions");
  // The canonical validator refuses fabricated evidence or a nonexistent prerequisite.
  for (const mutate of [
    (l: typeof exercise) => { l.prerequisites = ["invented-queue-prerequisite"]; },
    (l: typeof exercise) => { l.explanation = ["The simulator shows that every job runs exactly once.", ...l.explanation.slice(1)]; }
  ]) {
    const content = structuredClone(learningContent), l = content.lessons.find(l => l.id === exercise.id)!;
    mutate(l); expect(validateLearningContent(content).length).toBeGreaterThan(0);
  }
});

test("async depth has canonical reviewed practice at all three levels and honest evidence labels", () => {
  expect(() => checkLearningAuthoring(learningContent)).not.toThrow();
  const lessons = learningContent.lessons.filter(l => l.trackId === "async");
  const table = Object.fromEntries(["beginner", "intermediate", "advanced"].map(level => [level,
    Object.fromEntries(["reading", "conceptual-exercise", "executable-lab"].map(kind => [kind, lessons.filter(l => l.level === level && l.kind === kind).length]))]));
  // Lower bounds: later lanes added advanced reasoning lessons, which only raise these counts.
  const minimum = {beginner: {reading: 1, "conceptual-exercise": 1, "executable-lab": 1},
    intermediate: {reading: 1, "conceptual-exercise": 1, "executable-lab": 3},
    advanced: {reading: 0, "conceptual-exercise": 0, "executable-lab": 1}};
  for (const [level, kinds] of Object.entries(minimum)) for (const [kind, n] of Object.entries(kinds)) {
    expect((table as Record<string, Record<string, number>>)[level]![kind]!).toBeGreaterThanOrEqual(n);
  }
  const lab = lessons.find(l => l.id === "parallel-jobs-for-a-burst")!;
  expect(lab).toMatchObject({kind: "executable-lab", level: "advanced", contentVersion: 1, moduleId: "burst-workers", check: null});
  const entry = latestChallenge(lab.experiment!.challengeId)!;
  expect(REVIEWED_CHALLENGES[`${lab.id}@1`]).toEqual({challengeId: entry.definition.id, version: 1, hash: entry.hash});
  expect(lab.prerequisites.every(id => learningContent.lessons.some(l => l.id === id))).toBe(true);
  expect(entry.definition.hints).toHaveLength(3); expect(entry.definition.hints[2]).toContain("Jobs in parallel");
  console.info(JSON.stringify({async: table}));
});
