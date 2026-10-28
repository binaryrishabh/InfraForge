import { expect, test } from "bun:test";
import { answers, attemptReport, definition, REFERENCE } from "./challengeHarness";

// The CPU spike starts at second 30 and the attempt is judged at 50, its last active second.
test("published CPU-pressure challenge calibrates every criterion and evaluates target-health predictions", () => {
  const d = definition("headroom-under-cpu-pressure");
  const prediction = answers(d, { "baseline-health": "healthy", "target-health": "saturated", "overall-health": "saturated", "scale-out": "no" });
  const starter = attemptReport(d, d.starter!, prediction);
  const reference = attemptReport(d, REFERENCE[d.id]!, answers(d, { "baseline-health": "healthy", "target-health": "healthy", "overall-health": "healthy", "scale-out": "no" }));
  expect(starter.challenge?.status).toBe("not-met"); expect(reference.challenge?.status).toBe("met");
  expect(starter.challenge?.predictions.map((p) => p.outcome)).toEqual(["matched", "matched", "matched", "matched"]);
  expect(reference.challenge?.predictions.map((p) => p.outcome)).toEqual(["matched", "matched", "matched", "matched"]);
  expect(starter.experimentTrace?.sampleCount).toBe(50);
  const app2 = (second: number) => starter.experimentTrace?.points.find((p) => p.simulatedSeconds === second)?.resources.find((r) => r.id === "app-2");
  expect(app2(30)?.health).toBe("healthy");
  expect(app2(50)?.health).toBe("saturated");
  expect(app2(50)?.cpu).toBeGreaterThan(90);
}, 120000);
