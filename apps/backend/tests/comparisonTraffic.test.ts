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

test("evidence recorded in only one run is shown with the other side Unknown, never zero, and says why", () => {
  const b = structuredClone(a);
  delete b.traffic!.clientRetry;
  delete b.traffic!.objective;
  const noRetry = { version: 2, workloadProfile: {}, adapterProfiles: [] } as never;
  const withRetry = { version: 2, workloadProfile: { clientRetry: { maxAttempts: 3 }, workloadObjective: { maxResponseMs: 10 } }, adapterProfiles: [] } as never;
  const rows = compareTraffic(a, b, true, [withRetry, noRetry]);
  expect(rows).toHaveLength(9);
  const oneSided = rows.filter(m => m.delta === null);
  expect(oneSided.map(m => m.field)).toEqual(["Client retry load factor, whole run", "Objective: requests in time, worst-case % (whole run)",
    "Objective: requests in time, best-case % (whole run)", "Timed-out attempts, whole run"]);
  for (const m of oneSided) expect(m).toMatchObject({ later: null });
  expect(oneSided[0]).toMatchObject({ earlier: 1.2, withheldReason: "Recorded for the earlier run but not the later run. Client retries were off in that run. A direct comparison is unavailable." });
  expect(oneSided[1]!.withheldReason).toContain("No service objective was set in that run.");
  // The same pair the other way round names the earlier side as the one without evidence.
  expect(compareTraffic(b, a, true, [noRetry, withRetry]).filter(m => m.delta === null).every(m => m.earlier === null && m.later !== null)).toBe(true);
  expect(compareTraffic(b, a, true)[5]!.withheldReason).toBe("Recorded for the later run but not the earlier run. Client retry measurements were not recorded for that run. A direct comparison is unavailable.");
  // A run with no traffic block at all gets the broader reason, on every row, and two runs without any have no rows.
  const none = compareTraffic(null, a, false);
  expect(none).toHaveLength(9);
  expect(none.every(m => m.earlier === null && m.delta === null && m.withheldReason!.includes("Traffic outcomes were not recorded for that run."))).toBe(true);
  expect(compareTraffic(null, null, true)).toEqual([]);
  // Blocks present but values Unknown: said to be Unknown, not "off" or "not recorded".
  const unknown = structuredClone(a);
  delete unknown.traffic!.clientRetry!.attemptsTimedOut;
  unknown.traffic!.clientRetry!.extraLoadFactor = null;
  unknown.traffic!.objective!.worstCaseFraction = null;
  unknown.traffic!.objective!.bestCaseFraction = null;
  const unknownRows = compareTraffic(a, unknown, true, [withRetry, withRetry]);
  expect(unknownRows).toHaveLength(9);
  expect(unknownRows.filter(m => m.delta === null).every(m => m.withheldReason!.includes("This measurement is Unknown for that run."))).toBe(true);
});
