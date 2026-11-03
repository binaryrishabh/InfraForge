import { expect, test } from "bun:test";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { compareTraffic } from "../comparison/traffic";

const a: ReportCheckpoint = { resources: [], traffic: {
  offeredRps: 10, completedRps: 8, failedRps: 2, latencyMs: { p50: 3, p95: 8, p99: 10 },
  clientRetry: { originalsOffered: 100, totalAttempts: 120, retriesScheduled: 20, retriesIssued: 20,
    recovered: 10, exhausted: 5, givenUp: 0, attemptRps: 12, extraLoadFactor: 1.2,
    attemptsTimedOut: 7, ineligibleByReason: {}, perAttemptOutcomes: [] },
  objective: { version: 1, objective: { version: 1, maxResponseMs: 10, targetSuccessPercent: 95 },
    throughUs: 10_000_000, horizonUs: 10_000_000, offered: 100, good: 80, late: 10, failed: 0,
    deadlineExceeded: 0, abandoned: 0, unresolvedPastThreshold: 0, pending: 10, status: "missed",
    measuredFraction: 0.8, worstCaseFraction: 0.8, bestCaseFraction: 0.9 },
} };

test("retry, timeout and objective rows compare cumulative units without mixing last-second rates", () => {
  const b = structuredClone(a);
  b.traffic!.clientRetry!.extraLoadFactor = 1.5;
  b.traffic!.clientRetry!.attemptsTimedOut = 9;
  b.traffic!.objective!.worstCaseFraction = 0.85;
  b.traffic!.objective!.bestCaseFraction = 0.95;
  const rows = compareTraffic(a, b, true);
  expect(rows).toHaveLength(9);
  expect(rows.slice(5)).toEqual([
    { field: "Client retry load factor, whole run", unit: "attempts/original", earlier: 1.2, later: 1.5, delta: 1.5 - 1.2 },
    { field: "Objective: requests in time, worst-case % (whole run)", unit: "%", earlier: 80, later: 85, delta: 5 },
    { field: "Objective: requests in time, best-case % (whole run)", unit: "%", earlier: 90, later: 95, delta: 5 },
    { field: "Timed-out attempts, whole run", unit: "attempts", earlier: 7, later: 9, delta: 2 },
  ]);
  expect(compareTraffic(a, b, false).every(m => m.delta === null && !!m.withheldReason)).toBe(true);
  expect(compareTraffic(a, a, true).every(m => m.delta === 0)).toBe(true);
});

test("missing blocks, missing timeout counters and unknown fractions consistently omit rows", () => {
  const b = structuredClone(a);
  delete b.traffic!.clientRetry;
  delete b.traffic!.objective;
  expect(compareTraffic(a, b, true)).toHaveLength(5);
  expect(compareTraffic(b, a, true)).toHaveLength(5);
  expect(compareTraffic(null, a, false)).toEqual([]);
  const unknown = structuredClone(a);
  delete unknown.traffic!.clientRetry!.attemptsTimedOut;
  unknown.traffic!.clientRetry!.extraLoadFactor = null;
  unknown.traffic!.objective!.worstCaseFraction = null;
  unknown.traffic!.objective!.bestCaseFraction = null;
  expect(compareTraffic(a, unknown, true)).toHaveLength(5);
});
