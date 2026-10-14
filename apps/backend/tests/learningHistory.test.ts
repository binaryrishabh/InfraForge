import { expect, test } from "bun:test";
import { learningAttempt } from "../challenges/history";
import { answers, attemptRow, definition, REFERENCE } from "./challengeHarness";

test("learning facts preserve the recorded version, raw requirements and separate predictions", () => {
  const d = definition("headroom-under-cpu-pressure");
  const prediction = answers(d, { "baseline-health": "healthy", "target-health": "saturated", "overall-health": "saturated", "scale-out": "no" });
  const row = attemptRow(d, d.starter!, prediction), result = learningAttempt(row);
  expect(result).toMatchObject({ version: 1, category: "resilience", fault: "cpu-spike", status: "not-met", metCount: 2, total: 3,
    predictionMatched: 4, predictionKnown: 4, predictionTotal: 4, canRetry: true });
  expect(learningAttempt({ ...row, challengeVersion: 2, challengeSpecHash: "b".repeat(64) })).toMatchObject({ version: 2, status: "unavailable", canRetry: false });
  expect(() => learningAttempt({ ...row, challengeId: null })).toThrow("challenge attempt");
});

test("design attempts have no invented fault or time series and active history is not retryable", () => {
  const d = definition("first-production-api"), prediction = answers(d, { "overall-health": "healthy", "busiest-type": "Database" });
  const row = attemptRow(d, REFERENCE[d.id]!, prediction);
  expect(learningAttempt(row)).toMatchObject({ category: "design", fault: null, status: "met" });
  expect(learningAttempt({ ...row, status: "live", runtimeActive: true, terminalSnapshot: null }).canRetry).toBe(false);
});
