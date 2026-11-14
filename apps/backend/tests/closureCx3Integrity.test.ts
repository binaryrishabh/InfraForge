import { expect, test } from "bun:test";
import { LEARNING_REGISTRY } from "../learning/registry";
import { learningContent } from "../learning/content";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { checkLessonClaims } from "../learning/claims";
import { findChallenge } from "../challenges/registry";

test("empty-answer lesson keeps its original text and challenge identity while fixing prerequisite level and follow-up prose", () => {
  const id = "cache-an-empty-answer", old = LEARNING_REGISTRY.findLesson(id, 1)!, next = LEARNING_REGISTRY.findLesson(id, 2)!;
  expect(LEARNING_REGISTRY.findLesson(id)!.contentVersion).toBeGreaterThanOrEqual(2);
  expect(learningContent.archivedLessons).toContainEqual(old);
  expect(next).toEqual({...old, contentVersion: 2,
    prerequisites: old.prerequisites.map(p => p === "share-a-cache-fill" ? "concurrent-cache-misses" : p),
    followUp: old.followUp!.replace("negative-cache run", "negative cache run").replace("source-work budget", "source work budget"),
    // The visibility cost of caching absence (added by the independent audit) lives in the current version only.
    limitations: [old.limitations[0]!.replace("earlier cached absence. Saved absence settings", "earlier cached absence. That is the cost of caching absence: a remembered empty answer can hide a row published later, as Resolve after publication shows for a resolver's negative answer, and this lab shows only the benefit. Saved absence settings"), ...old.limitations.slice(1)],
  });
  expect(next.level).toBe("intermediate");
  expect(LEARNING_REGISTRY.findLesson("concurrent-cache-misses")!.level).toBe("intermediate");
  const d = findChallenge(id, 1)!;
  expect(REVIEWED_CHALLENGES[`${id}@2`]).toEqual(REVIEWED_CHALLENGES[`${id}@1`]);
  expect(REVIEWED_CHALLENGES[`${id}@2`]).toEqual({challengeId: id, version: 1, hash: d.hash});
  expect(checkLessonClaims(next, d.definition)).toEqual([]);
});
