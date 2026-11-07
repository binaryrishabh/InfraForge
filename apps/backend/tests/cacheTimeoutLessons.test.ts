import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { evidenceLabels, learningMeasurement } from "@infraforge/contracts/learning";
import { learningContent } from "../learning/content";
import { checkLearningAuthoring } from "../learning/authoring";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { lessonText } from "../learning/claims";

const originals = [
  [
    "data/lessons/reuse-before-expiry.ts",
    "9bda608ae5a5123036de7615327513f77270a6a287ba78fbd032daf0076843d0"
  ],
  [
    "depth/lessons/share-a-cache-fill.ts",
    "63ccb8d3c5a082c50030bb8f5985cc1e55d1a2fc4da9fdd8ba4ad7dc1bbc0308"
  ],
  [
    "architecture/lessons/cache-or-database.ts",
    "3add165b699c9196f39819e11139551f0545d2f80470e7b118ace8d4690b64e3"
  ],
  [
    "missions/lessons/catalogue-link-flash.ts",
    "ec35e2c2f52ff3ceb28227a12fa7278115fac2bf8c599fd66e21d6dee0f5a637"
  ],
  [
    "depth/lessons/timeout-ownership.ts",
    "8b21eccd1911f044eb8bbb28a2fafadc01a18abd67a79653780acf4e62214428"
  ],
  [
    "architecture/lessons/compare-designs-honestly.ts",
    "0adf19ad4c1a5060d4372b8ca0d6ee5d97a8261db97ece83c3ead583000b13fa"
  ]
] as const;
for (const [file, hash] of originals) test(`cache/timeout refresh preserves source and explicit old lookup: ${file}`, () => {
  const source = readFileSync(new URL(`../learning/content/${file}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  expect(createHash("sha256").update(source).digest("hex")).toBe(hash);
  const id = file.split("/").at(-1)!.replace(".ts", "");
  const old = LEARNING_REGISTRY.findLesson(id, 1)!;
  const current = LEARNING_REGISTRY.findLesson(id)!;
  expect(old.contentVersion).toBe(1); expect(current.contentVersion).toBe(2);
  expect(learningContent.archivedLessons).toContainEqual(old);
  expect(LEARNING_REGISTRY.listLessons({trackId: current.trackId, moduleId: current.moduleId})
    .filter(l => l.id === id).map(l => l.contentVersion)).toEqual([2]);
  expect(current.limitations.join(" ")).toContain("Unknown");
  if (current.kind === "executable-lab") {
    const labels = current.experiment.evidenceToInspect!.flatMap(evidenceLabels);
    expect(labels).toContain("Cache: Hits"); expect(labels).toContain("Application helper: Database fetches");
    for (const label of labels) expect(learningMeasurement(label)).not.toBeNull();
    expect(REVIEWED_CHALLENGES[`${id}@2`]).toEqual(REVIEWED_CHALLENGES[`${id}@1`]);
    const missing = {...REVIEWED_CHALLENGES}; delete missing[`${id}@2`];
    expect(() => checkLearningAuthoring(learningContent, missing)).toThrow(`${id}@2: missing challenge review`);
    const changed = {...REVIEWED_CHALLENGES, [`${id}@2`]: {...REVIEWED_CHALLENGES[`${id}@2`]!, hash: "0".repeat(64)}};
    expect(() => checkLearningAuthoring(learningContent, changed)).toThrow(`${id}@2: reviewed challenge identity is unavailable or changed`);
  }
});

test("an unrendered superseded population is refused; timeout lesson remains conceptual and concurrent-miss reading is not duplicated", () => {
  const content = structuredClone(learningContent);
  const lab = content.lessons.find(l => l.id === "share-a-cache-fill")!;
  lab.experiment!.evidenceToInspect = ["Superseded outcomes; invented cache hit ratio"];
  expect(() => checkLearningAuthoring(content)).toThrow("report does not render measurement Superseded outcomes");
  expect(() => checkLearningAuthoring(content)).toThrow("report does not render measurement invented cache hit ratio");
  expect(learningMeasurement("Superseded outcomes")).toBeNull();
  const timeout = LEARNING_REGISTRY.findLesson("timeout-ownership")!;
  expect(timeout.kind).toBe("conceptual-exercise"); expect(timeout.experiment).toBeNull();
  for (const label of ["Timed-out attempts", "Wasted completions", "Timeout cancellations requested", "Confirmed at entry", "Recovered after timeout"]) {
    expect(timeout.limitations.join(" ")).toContain(label); expect(learningMeasurement(label)).not.toBeNull();
  }
  expect(LEARNING_REGISTRY.findLesson("concurrent-cache-misses")!.contentVersion).toBe(1);
  expect(learningContent.lessons.filter(l => l.id === "concurrent-cache-misses")).toHaveLength(1);
  expect(checkLearningAuthoring(learningContent).archived).toBeGreaterThanOrEqual(14); // Later lanes archive more versions.
});

test("current affected lessons do not describe cache or timeout evidence as live-only or absent", () => {
  const ids = new Set(originals.map(([file]) => file.split("/").at(-1)!.replace(".ts", "")));
  const stale = learningContent.lessons.filter(l => ids.has(l.id)).flatMap(l => lessonText(l)
    .filter(([, text]) => /live-only|(?:report|vocabulary).*(?:does not retain|not retain|does not expose|absent from)/i.test(text))
    .map(([field]) => `${l.id} ${field}`));
  expect(stale).toEqual([]);
});
