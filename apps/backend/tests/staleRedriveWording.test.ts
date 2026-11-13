import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { findLearningLesson } from "../learning/registry";
import { attemptReport, answers, definition, REFERENCE } from "./challengeHarness";

// Wording must name what the engine measures: the cache records how long past expiry a retained body was served
// (cache.ts get-stale: ageUs = now - expires), so the body itself is at most TTL + bound old.
const text = (v: unknown) => JSON.stringify(v);

test("serve-stale-on-error says 'past expiry', never 'no older than' or 'a minute old'", () => {
  const d = definition("serve-stale-on-error"), lesson = findLearningLesson("serve-stale-on-error");
  for (const where of [text(d.story), d.objective, text(d.criteria), text(d.hints), text(d.debrief), text(lesson)]) expect(where).not.toMatch(/no older than|a minute old/);
  expect(d.objective).toContain("past expiry");
  expect(d.criteria.find(c => c.id === "stale")!.label).toContain("past expiry");
  expect(text(lesson)).toMatch(/TTL plus the bound|at most the TTL plus/);
});

test("the stale criterion detail and the report label name the quantity they measure", () => {
  const d = definition("serve-stale-on-error"), report = attemptReport(d, REFERENCE[d.id]!, answers(d, { health: "healthy" }));
  expect(report.challenge!.criteria.find(c => c.id === "stale")!.detail).toMatch(/s past expiry \(maximum \d+ s past expiry\)/);
  expect(Object.keys(LEARNING_REPORT_MEASUREMENTS)).toContain("Cache: Oldest stale answer past expiry (us)");
  expect(Object.keys(LEARNING_REPORT_MEASUREMENTS)).not.toContain("Cache: Oldest stale answer (us)");
  expect(readFileSync(new URL("../../web/src/features/reports/components/CacheReadings.tsx", import.meta.url), "utf8")).toContain("Cache: Oldest stale answer past expiry (us)");
}, 120000);

test("redrive wording says the queue's capacity decides how many return, not 'every' message", () => {
  const d = definition("redrive-after-the-fix"), lesson = findLearningLesson("redrive-after-the-fix");
  for (const where of [text(d.story), text(lesson)]) expect(where).not.toMatch(/returns every dead-lettered/);
  expect(text(d.story)).toMatch(/as many as the queue's capacity admits/);
  expect(text(lesson)).toMatch(/as many as the queue's capacity admits/);
});
