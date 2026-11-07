import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { evidenceLabels } from "@infraforge/contracts/learning";
import { learningContent } from "../learning/content";
import { checkLearningAuthoring } from "../learning/authoring";
import { lessonText } from "../learning/claims";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { findChallenge } from "../challenges/registry";
import { memoryIsNotCpu } from "../learning/content/diagnosis/lessons/memory-is-not-cpu";
import { fitARequestInMemory } from "../learning/content/diagnosis/lessons/fit-a-request-in-memory";

// Pin the original source, normalizing only checkout line endings as on Linux CI.
for (const [file, hash] of [
  ["diagnosis/lessons/memory-is-not-cpu.ts", "fe0f48381326a4f9aa3c480afa9dbd9fa58006440533b4d23f4b609d913fe8b7"],
  ["diagnosis/lessons/fit-a-request-in-memory.ts", "ab6bba796cd98b9f21efa04ababded27a5122e39b377f5d76fb455d2070a19bd"],
  ["architecture/lessons/split-the-capacity-budget.ts", "9bb8a5ca3633a15f8ab52c982ac3c8af71235f29f1c75378a0ff5b7e7aeca78f"],
  ["architecture/lessons/split-the-capacity-budget-v2.ts", "02ccc421195d8d02c1d1f2dbc003485cd1286b5903aac4adfdc8efdff9c5b31d"],
]) test(`report refresh preserves original source ${file}`, () => {
  const source = readFileSync(new URL(`../learning/content/${file}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  expect(createHash("sha256").update(source).digest("hex")).toBe(hash!);
});

for (const old of [memoryIsNotCpu, fitARequestInMemory]) test(`${old.id}: latest listing uses the reviewed version and explicit old lookup keeps the original`, () => {
  const current = LEARNING_REGISTRY.findLesson(old.id)!;
  const latestVersion = old.id === "fit-a-request-in-memory" ? 3 : 2;
  expect(current.contentVersion).toBe(latestVersion);
  expect(LEARNING_REGISTRY.findLesson(old.id, 1)).toEqual(old);
  expect(learningContent.archivedLessons).toContainEqual(old);
  expect(LEARNING_REGISTRY.findLesson(old.id, latestVersion)).toEqual(current);
  expect(LEARNING_REGISTRY.findLesson(old.id, latestVersion + 1)).toBeNull();
  expect(LEARNING_REGISTRY.listLessons({trackId: old.trackId, moduleId: old.moduleId})
    .filter(l => l.id === old.id).map(l => l.contentVersion)).toEqual([latestVersion]);
  expect(current.limitations.join(" ")).toContain("Unknown");
  // Registry reads are isolated; retrieving an archive cannot mutate the next read.
  const copy = LEARNING_REGISTRY.findLesson(old.id, 1)!; copy.explanation[0] = "changed";
  expect(LEARNING_REGISTRY.findLesson(old.id, 1)).toEqual(old);
});

test("memory lesson v2 requires both unchanged challenge identities and refuses missing or changed reviews", () => {
  const id = "fit-a-request-in-memory", latest = LEARNING_REGISTRY.findLesson(id)!;
  expect(latest.experiment!.evidenceToInspect!.flatMap(evidenceLabels).filter(label => label.startsWith("VM memory:"))).toHaveLength(7);
  expect(checkLearningAuthoring(learningContent).archived).toBe(14);
  for (const version of [1, 2]) {
    const key = `${id}@${version}`, review = REVIEWED_CHALLENGES[key]!;
    expect(review).toEqual({challengeId: id, version: 1, hash: findChallenge(id, 1)!.hash});
    const missing = {...REVIEWED_CHALLENGES}; delete missing[key];
    expect(() => checkLearningAuthoring(learningContent, missing)).toThrow(`${key}: missing challenge review`);
    const changed = {...REVIEWED_CHALLENGES, [key]: {...review, hash: "0".repeat(64)}};
    expect(() => checkLearningAuthoring(learningContent, changed)).toThrow(`${key}: reviewed challenge identity is unavailable or changed`);
  }
  expect(LEARNING_REGISTRY.findLesson("memory-is-not-cpu")!.experiment).toBeNull();
});

test("audit: no current lesson still claims the refreshed memory or cost report blocks are absent", () => {
  const stale = learningContent.lessons.flatMap(lesson => lessonText(lesson)
    .filter(([, text]) => /(?:report|saved memory fields).*(?:omits (?:the detailed memory|individual SKU)|does not (?:render|display).*(?:memory|counter|price|budget)|no report renderer)|live-only diagnostic gap/i.test(text))
    .map(([field]) => `${lesson.id}@${lesson.contentVersion} ${field}`));
  expect(stale).toEqual([]);
});
