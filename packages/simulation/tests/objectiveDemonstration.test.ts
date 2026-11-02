import { expect, test } from "bun:test";
import { objectiveDemonstration } from "./objectiveDemonstration.fixture";
import { evaluateObjective } from "../src/model2/workload/objective";

test("same-target demonstration conserves originals and separates arrival variability from retries", () => {
  const demo = objectiveDemonstration();
  expect(demo.arrivalsBandCIdentical).toBe(true);
  expect(demo.repeatIdentical).toBe(true);
  expect(demo.runs.B.objective.offered).toBe(demo.runs.C.objective.offered);
  for (const run of Object.values(demo.runs)) {
    const o = run.objective;
    expect(o.objective).toEqual(demo.objective);
    expect(o.offered).toBe(o.good + o.late + o.failed + o.deadlineExceeded + o.abandoned + o.unresolvedPastThreshold + o.pending);
    expect(o.status).toBe(evaluateObjective(o, demo.objective.targetSuccessPercent).status);
    expect(run.attempts).toBeGreaterThanOrEqual(o.offered);
  }
  expect(demo.runs.A.objective.failed).toBe(0);
  expect(demo.runs.A.objective.late).toBe(0);
  console.info("traffic-objectives-demonstration", JSON.stringify(demo));
});
