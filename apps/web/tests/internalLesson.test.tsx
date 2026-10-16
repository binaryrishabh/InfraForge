import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { LessonReview as Review } from "@infraforge/contracts/internal-lessons";
import { restartLesson } from "@infraforge/contracts/internal-lessons/profile";
import { LessonReview } from "../src/features/internalLessons/LessonReview";
import { LessonResult } from "../src/features/internalLessons/LessonResult";
import { readLessonDraft, saveLessonDraft } from "../src/features/internalLessons/lessonDraft";
const review: Review = { choice: { schema: "object-restart/1", infrastructureId: "owned-design", expectedDesignUpdatedAt: "2026-10-16T00:00:00.000Z", idempotencyKey: "exact-retry", phase: "after" }, draft: restartLesson("after"), reviewHash: "a".repeat(64), image: `sha256:${"b".repeat(64)}`, explanation: ["Physical durability remains Unknown"], review: { request: { infrastructureId: "owned-design", expectedDesignUpdatedAt: "2026-10-16T00:00:00.000Z", idempotencyKey: "exact-retry", workload: {}, contract: {} }, requestHash: "c".repeat(64), revision: "2026-10-16T00:00:00.000Z", designName: "<script>owned</script>", fields: [], assumptions: [], arrivals: 1 } };
test("lesson review keeps consent, educational limits and exact uncertain retry visible", () => {
  const html = renderToStaticMarkup(<LessonReview value={review} pending={false} busy={false} submit={() => {}} edit={() => {}} />);
  expect(html).toContain("I accept the teaching assumptions"); expect(html).toContain("exact-retry"); expect(html).toContain("Physical durability remains Unknown"); expect(html).not.toContain("<script>");
  expect(html).toContain('disabled=""');
  const pending = renderToStaticMarkup(<LessonReview value={review} pending busy={false} submit={() => {}} edit={() => {}} />);
  expect(pending).toContain("Retry exact lesson submission"); expect(pending).toContain("including after refresh");
});
test("lesson Unknown cannot render a manufactured zero-byte read", () => {
  const html = renderToStaticMarkup(<LessonResult value={{ profile: "Unknown", phase: "Unknown", kind: "Unknown", readOutcome: "Unknown", returnedBytes: null, explanation: "Incomplete prefix", limits: ["Physical timing Unknown"] }} />);
  expect(html).toContain("returned object bytes Unknown"); expect(html).not.toContain("0 returned object bytes"); expect(html).toContain("Incomplete prefix");
});
test("lesson pending retry survives refresh only for its owner and corrupt storage fails safely", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"), entries = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) } });
  try {
    const saved = { design: "owned-design", phase: "after" as const, review, pending: true, lastRun: "" };
    expect(saveLessonDraft("alice", saved)).toBe(true); expect(readLessonDraft("alice")).toEqual(saved); expect(readLessonDraft("bob").pending).toBe(false);
    entries.set("infraforge-object-restart/1:alice", JSON.stringify({ ...saved, review: { ...review, choice: { ...review.choice, phase: "invented" } } }));
    expect(readLessonDraft("alice").review).toBeNull();
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => { throw Error("Denied"); } });
    expect(saveLessonDraft("alice", saved)).toBe(false); expect(readLessonDraft("alice").review).toBeNull();
  } finally { if (original) Object.defineProperty(globalThis, "sessionStorage", original); else Reflect.deleteProperty(globalThis, "sessionStorage"); }
});
