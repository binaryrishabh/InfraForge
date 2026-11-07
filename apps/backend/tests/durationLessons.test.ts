import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { evidenceLabels, learningMeasurement } from "@infraforge/contracts/learning";
import { learningContent } from "../learning/content";
import { checkLearningAuthoring } from "../learning/authoring";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";

const originals = [
  [
    "diagnosis/lessons/locate-the-missing-wait.ts",
    1,
    "af506b82d45bdd62920ca41c8d33b0b7ff7f2a111018bd24dceaac550925fec2"
  ],
  [
    "diagnosis/lessons/diagnose-query-admission.ts",
    1,
    "d6209a51265127751870a597a9128ecad23152adaa10a2a3935e66971804d6f5"
  ],
  [
    "diagnosis/lessons/diagnose-consumer-credit-v2.ts",
    2,
    "543fe39f28041a2e4fd5c58539a14df41d2b3399bdb93d4f5c9fbb66275fa83b"
  ],
  [
    "advanced/lessons/trace-a-saturation-cascade.ts",
    1,
    "252f8090100f60121846494e6799a6027d88dddc5146c4e825093dafde0ef398"
  ]
] as const;
for (const [file, version, hash] of originals) test(`duration refresh preserves archived source: ${file}`, () => {
  const source = readFileSync(new URL(`../learning/content/${file}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  expect(createHash("sha256").update(source).digest("hex")).toBe(hash);
  const id = file.split("/").at(-1)!.replace(/-v\d+\.ts$|\.ts$/, "");
  const old = LEARNING_REGISTRY.findLesson(id, version)!, current = LEARNING_REGISTRY.findLesson(id)!;
  expect(old.contentVersion).toBe(version); expect(current.contentVersion).toBe(version + 1);
  expect(learningContent.archivedLessons).toContainEqual(old);
  expect(current.explanation.join(" ")).toContain("Duration: Slot hold");
  if (current.kind === "executable-lab") {
    const labels = current.experiment.evidenceToInspect!.flatMap(evidenceLabels);
    expect(labels).toContain("Duration: Acquired pool wait");
    for (const label of labels) expect(learningMeasurement(label)).not.toBeNull();
    expect(REVIEWED_CHALLENGES[`${id}@${version + 1}`]).toEqual(REVIEWED_CHALLENGES[`${id}@${version}`]);
    const missing = {...REVIEWED_CHALLENGES}; delete missing[`${id}@${version + 1}`];
    expect(() => checkLearningAuthoring(learningContent, missing)).toThrow("missing challenge review");
  } else {
    expect(current.experiment).toBeNull(); expect(current.explanation.join(" ")).toContain("remain Unknown");
  }
});
