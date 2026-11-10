import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { connectionPoolBudgets } from "../learning/content/data/lessons/connection-pool-budgets";
import { LEARNING_REGISTRY } from "../learning/registry";
import { checkLessonClaims } from "../learning/claims";

test("pool control correction preserves the published source and resolves both versions", () => {
  const source = readFileSync(new URL("../learning/content/data/lessons/connection-pool-budgets.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  expect(createHash("sha256").update(source).digest("hex")).toBe("862629c78e6187335db24937ae1d335863f231b5fc4a5c67ea83733949e331bf");
  expect(LEARNING_REGISTRY.findLesson(connectionPoolBudgets.id, 1)).toEqual(connectionPoolBudgets);
  const current = LEARNING_REGISTRY.findLesson(connectionPoolBudgets.id)!;
  expect(current).toEqual({...connectionPoolBudgets, contentVersion: 2, limitations: current.limitations});
  expect(LEARNING_REGISTRY.listLessons({trackId: "data"}).filter(l => l.id === current.id).map(l => l.contentVersion)).toEqual([2]);
  expect(current.limitations.join(" ")).toContain("Application database connections is an editable");
  expect(current.limitations.join(" ")).toContain("size-the-app-database-pool");
  expect(checkLessonClaims(current)).toEqual([]);
  expect(checkLessonClaims({...current, explanation: ["The recorded run serves 999 requests per second."]}).join(" ")).toContain("non-executable lesson");
});
