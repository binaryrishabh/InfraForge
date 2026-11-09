import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { promotingAReplica } from "../learning/content/data/lessons/promoting-a-replica";
import { LEARNING_REGISTRY } from "../learning/registry";
import { checkLessonClaims } from "../learning/claims";

test("promotion choice correction preserves published text and keeps conceptual outcomes unclaimed", () => {
  const source = readFileSync(new URL("../learning/content/data/lessons/promoting-a-replica.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  expect(createHash("sha256").update(source).digest("hex")).toBe("51ca94995468d4c3d0dacd309f931317570342080b0d5bff272e4f7b34bbb7ca");
  expect(LEARNING_REGISTRY.findLesson(promotingAReplica.id, 1)).toEqual(promotingAReplica);
  const current = LEARNING_REGISTRY.findLesson(promotingAReplica.id)!;
  expect(current.contentVersion).toBe(2);
  expect(current).toEqual({...promotingAReplica, contentVersion: 2, explanation: current.explanation, limitations: current.limitations});
  expect(current.explanation.slice(0, 3)).toEqual(promotingAReplica.explanation.slice(0, 3));
  expect(current.limitations.slice(1)).toEqual(promotingAReplica.limitations.slice(1));
  expect(LEARNING_REGISTRY.listLessons({trackId: "data"}).filter(l => l.id === current.id).map(l => l.contentVersion)).toEqual([2]);
  expect(current.explanation.join(" ")).toContain("restore-a-database-writer");
  expect(current.explanation.join(" ")).toContain("Promote at simulated second");
  expect(checkLessonClaims(current)).toEqual([]);
  expect(checkLessonClaims({...current, explanation: ["The recorded run recovered after 2 seconds."]}).join(" ")).toContain("non-executable lesson");
});
