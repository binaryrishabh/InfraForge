import { expect, test } from "bun:test";
import { attemptTimeoutDemonstration } from "./attemptTimeoutDemonstration.fixture";

test("arithmetic-first timeout demonstration preserves originals and proves measured mechanisms", () => {
  const demo = attemptTimeoutDemonstration();
  expect(demo.originalsIdentical).toBe(true); expect(demo.repeatIdentical).toBe(true);
  expect(demo.runs.C.attemptsTimedOut).toBeGreaterThan(0);
  expect(demo.runs.A.attemptsTimedOut).toBeNull(); expect(demo.runs.B.attemptsTimedOut).toBeNull();
  for (const run of Object.values(demo.runs)) {
    expect(run.factor).toBe(run.attempts / run.originals);
    expect(run.attempts).toBeGreaterThanOrEqual(run.originals);
    expect(run.uniqueTerminals).toBe(run.terminals);
    expect(run.completed + run.failed + run.inFlight).toBe(run.originals);
    expect(run.conservation).toBe(true); expect(run.objectivesConserved).toBe(true);
    expect(run.lbReceived).toBe(run.attempts);
  }
  expect(demo.runs.C.wastedCompletions).toBe(demo.runs.C.supersededOutcomes!.completed);
  console.info("attempt-timeout-demonstration", JSON.stringify(demo));
});
