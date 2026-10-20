import { expect, test } from "bun:test";
import { verifyG5, validateG5 } from "../reality/first-stack-pilots/g5-summary";

test("G5 retains the complete bounded semantic campaign and forbids promotion", () => {
  const { summary, result } = verifyG5();
  expect(result).toMatchObject({ result: "PASS", idleEstablished: 5, idleRefused: 2, lateCommits: 3, timingPromotion: false });
  expect(summary.priorAttempts).toHaveLength(1);
  expect(summary.artifacts.length).toBeGreaterThan(4);
  for (const mutate of [
    (s: typeof summary) => { s.timingPromotion = true; },
    (s: typeof summary) => { s.campaign.failures.push("missing observation"); },
    (s: typeof summary) => { s.observations.baseline!.events.find(e => e.id === "transaction-timeout-0")!.code = "57014"; },
    (s: typeof summary) => { s.observations.baseline!.events.find(e => e.id === "reconcile-0")!.rows = []; },
    (s: typeof summary) => { s.observations.fast!.events.find(e => e.id === "shutdown-query")!.code = null; },
  ]) { const copy = structuredClone(summary); mutate(copy); expect(() => validateG5(copy)).toThrow(); }
});
