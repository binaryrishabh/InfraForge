import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { learningMeasurement } from "@infraforge/contracts/learning";
import { learningContent } from "../learning/content";
import { checkLearningAuthoring } from "../learning/authoring";
import { checkLessonClaims } from "../learning/claims";
import { LEARNING_REGISTRY } from "../learning/registry";
import { dnsCacheLifetime as original } from "../learning/content/failures/lessons/dns-cache-lifetime";

test("DNS conceptual refresh preserves the original source and explicit version lookup", () => {
  const source = readFileSync(new URL("../learning/content/failures/lessons/dns-cache-lifetime.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  expect(createHash("sha256").update(source).digest("hex")).toBe("06110e8c30a23affaa924250bc25f66f2263c7d604dcc9833f0fbf77dc6a807d");
  const current = LEARNING_REGISTRY.findLesson(original.id)!;
  expect(current.contentVersion).toBe(2); expect(current.kind).toBe("conceptual-exercise"); expect(current.experiment).toBeNull();
  expect(LEARNING_REGISTRY.findLesson(original.id, 1)).toEqual(original);
  expect(learningContent.archivedLessons).toContainEqual(original);
  expect(LEARNING_REGISTRY.listLessons({trackId: "failures"}).filter(l => l.id === original.id).map(l => l.contentVersion)).toEqual([2]);
  expect(current.limitations.join(" ")).toContain("no DNS record-change intervention");
  expect(current.limitations.join(" ")).toContain("timestamped transition history");
  expect(checkLessonClaims(current)).toEqual([]);
  const fabricated = structuredClone(current); fabricated.explanation.push("The recorded run recovered after 2 seconds.");
  expect(checkLessonClaims(fabricated).join(" ")).toContain("non-executable lesson");
  for (const label of ["DNS: Resolver queries", "DNS: Cache hits", "DNS: Cache misses", "DNS: Authoritative lookups", "DNS: Through time", "DNS: Cached answer generation", "DNS: Cached answer expiry", "DNS: Cache expirations"]) {
    expect(current.explanation.join(" ")).toContain(label); expect(learningMeasurement(label)).not.toBeNull();
  }
  expect(checkLearningAuthoring(learningContent).archived).toBeGreaterThanOrEqual(19);
});
