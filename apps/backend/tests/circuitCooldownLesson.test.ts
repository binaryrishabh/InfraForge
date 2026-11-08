import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { findLearningLesson } from "../learning/registry";

test("one lesson refresh retains its byte-identical archive and resolves the real cooldown lab", async () => {
  const old = findLearningLesson("circuit-breaker-boundaries", 1)!, current = findLearningLesson(old.id)!;
  const bytes = await readFile(new URL("../learning/content/depth/lessons/circuit-breaker-boundaries.ts", import.meta.url));
  expect(createHash("sha256").update(bytes.toString("utf8").replaceAll("\r\n", "\n")).digest("hex")).toBe("9fde7a927db761bfc11837d116eeddbab86cd1c478e4e187365b50327424d332");
  expect(current.contentVersion).toBe(2); expect(old.contentVersion).toBe(1);
  expect(old.limitations.join(" ")).toContain("omit them");
  expect(current.explanation.join(" ")).toContain("Saved reports now show each path");
  expect(current.experiment).toBeNull(); expect(current.check!.correctChoiceId).toBe("path");
  expect(findLearningLesson("test-a-circuit-again")).toMatchObject({kind: "executable-lab", level: "advanced", experiment: {challengeId: "test-a-circuit-again"}});
});
