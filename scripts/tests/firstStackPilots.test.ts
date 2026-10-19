import { expect, test } from "bun:test";
import { distribution, population, textHash, validateSummary } from "../reality/first-stack-pilots/summary";

test("pilot text identity is independent of checkout line endings", () => {
  expect(textHash("one\r\ntwo\r\n")).toBe(textHash("one\ntwo\n"));
});
test("missing measurements remain Unknown and empirical quantiles retain sample count", () => {
  expect(distribution([])).toBeNull();
  expect(distribution([4, 1, 2, 3])).toEqual({ count: 4, mean: 2.5, min: 1, p50: 2, p95: 4, p99: 4, max: 4 });
});
test("generator loss, caller deadlines, server completion and censored work conserve separate populations", () => {
  const clients = [
    { id: "drop", outcome: "generator-drop", intendedUs: 0, actualSendUs: null, responseUs: null },
    { id: "timeout", outcome: "deadline", intendedUs: 0, actualSendUs: 10, responseUs: 100, deadlineUs: 100 },
    { id: "censored", outcome: "right-censored", intendedUs: 0, actualSendUs: 20, responseUs: null, deadlineUs: 100 },
    { id: "ok", outcome: "completed", intendedUs: 0, actualSendUs: 5, responseUs: 50, deadlineUs: 100 },
  ];
  const server = new Map([
    ["timeout", { outcome: "completed", receivedUs: 20, dispatchUs: 30, completedUs: 150, serverAfterDeadline: true, threadCpuUs: 20 }],
    ["ok", { outcome: "completed", receivedUs: 10, dispatchUs: 15, completedUs: 30, serverAfterDeadline: false, threadCpuUs: 10 }],
  ]);
  const p = population(clients, server, 1);
  expect(p.offered).toBe(4); expect(p.sent).toBe(3); expect(p.sentWithoutServer).toBe(1);
  expect(p.serverCompleted).toBe(2); expect(p.serverAfterDeadline).toBe(1); expect(p.cohortGoodputPerSecond).toBe(1);
  expect(p.completedLatencyFromIntendedUs?.count).toBe(1); expect(p.threadCpuUs?.count).toBe(2); expect(p.poolWaitUs).toBeNull();
});
test("duplicate roots cannot silently overwrite offered work", () => {
  expect(() => population([{ id: "x", outcome: "generator-drop", actualSendUs: null }, { id: "x", outcome: "generator-drop", actualSendUs: null }], new Map(), 1)).toThrow("Duplicate");
});
test("public timing promotion is rejected before inspecting a pilot record", () => {
  expect(() => validateSummary({ schema: "infraforge-g1-summary/1", scope: "local-semantic-pilot-only", timingPromotion: true, evidenceLabel: "supported-calibrated" })).toThrow("claim boundary");
});
