import { expect, test } from "bun:test";
import { checkLearningAuthoring } from "../learning/authoring";
import { learningContent } from "../learning/content";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { buildRegistry, REGISTRY } from "../challenges/registry";

test("check:learning validates all authored content and lists counts", () => {
  const counts = checkLearningAuthoring(learningContent);
  expect(counts).toEqual({ tracks: 1, lessons: 13, labs: 3, archived: 0 });
  console.info(`Learning: ${counts.tracks} tracks, ${counts.lessons} lessons, ${counts.labs} executable labs, ${counts.archived} archived versions`);
});

test("the authoring gate fails on deliberately broken content and a missing challenge", () => {
  const broken = structuredClone(learningContent);
  broken.lessons[0]!.limitations = [];
  expect(() => checkLearningAuthoring(broken)).toThrow("limitations");
  const missing = structuredClone(learningContent);
  const lab = missing.lessons.find((l) => l.kind === "executable-lab")!;
  lab.experiment!.challengeId = "missing";
  expect(() => checkLearningAuthoring(missing)).toThrow("unknown challengeId missing");
});

test("a newer latest challenge is a hard human-review failure even when old rules still exist", () => {
  const old = REGISTRY.latest("where-does-the-time-go")!.definition;
  const changed = buildRegistry([...REGISTRY.all().map((e) => e.definition), { ...old, version: old.version + 1 }]);
  expect(() => checkLearningAuthoring(learningContent, REVIEWED_CHALLENGES, changed)).toThrow("moved since contentVersion");
});

test("new content versions need review; missing or changed reviewed rules fail closed", () => {
  const content = structuredClone(learningContent);
  content.lessons.find((l) => l.kind === "executable-lab")!.contentVersion++;
  expect(() => checkLearningAuthoring(content)).toThrow("missing challenge review");
  const reviews = structuredClone(REVIEWED_CHALLENGES);
  reviews["where-does-the-time-go@1"]!.hash = "0".repeat(64);
  expect(() => checkLearningAuthoring(learningContent, reviews)).toThrow("identity is unavailable or changed");
  reviews["where-does-the-time-go@1"]!.version = 999;
  expect(() => checkLearningAuthoring(learningContent, reviews)).toThrow("identity is unavailable or changed");
});

test("a newly reviewed version can coexist with its immutable archived content", () => {
  const content = structuredClone(learningContent);
  const lab = content.lessons.find((l) => l.kind === "executable-lab")!;
  const oldLesson = structuredClone(lab);
  lab.contentVersion++;
  const old = REGISTRY.latest(lab.experiment!.challengeId)!.definition;
  const registry = buildRegistry([...REGISTRY.all().map((e) => e.definition), { ...old, version: old.version + 1 }]);
  const entry = registry.latest(old.id)!;
  expect(checkLearningAuthoring({ ...content, archivedLessons: [oldLesson] }, {
    ...REVIEWED_CHALLENGES, [`${lab.id}@${lab.contentVersion}`]: { challengeId: old.id, version: entry.definition.version, hash: entry.hash },
  }, registry)).toMatchObject({ archived: 1 });
});
