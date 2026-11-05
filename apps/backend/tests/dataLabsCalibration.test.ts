import { describe, expect, test } from "bun:test";
import type { ChallengeDefinition, ChallengeStarter } from "@infraforge/contracts/challenges";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { moveReadsOffTheWriterV1 as reads } from "../challenges/definitions/move-reads-off-the-writer/v1";
import { budgetAppDatabaseSessionsV1 as sessions } from "../challenges/definitions/budget-app-database-sessions/v1";
import { replicasDoNotTakeWritesV1 as writes } from "../challenges/definitions/replicas-do-not-take-writes/v1";
import { preflight } from "../challenges/preflight";
import { challengeSeed } from "../challenges/registry";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRunReport } from "../reports/report";
import { REFERENCE, answers, attemptRow } from "./challengeHarness";

const run = (d: ChallengeDefinition, design: ChallengeStarter) => attemptRow(d, design, answers(d, {"database-health": "healthy"}));
const db = (r: ReturnType<typeof buildRunReport>) => r.terminal!.resources.find(r => r.id === "db")!;
const summary = (r: ReturnType<typeof buildRunReport>) => ({status: r.challenge!.status, second: r.terminal!.simulatedSeconds,
  p95Ms: r.terminal!.traffic!.latencyMs.p95, completedRps: r.terminal!.traffic!.completedRps,
  failedRps: r.terminal!.traffic!.failedRps, wholeRun: r.terminal!.traffic!.wholeRun, database: db(r), pools: r.terminal!.pools});

describe("data labs: controlled Model 2 runs", () => {
  for (const d of [reads, sessions, writes]) test(`${d.id}: one-change reference passes and plausible near miss fails`, () => {
    const start = d.starter!, fixed = REFERENCE[d.id]!, restored = structuredClone(fixed), near = structuredClone(start);
    if (d.id === reads.id) {
      restored.resources.find(r => r.id === "db")!.databaseReadRouting!.policy = "primary-only";
      near.resources.find(r => r.id === "db")!.dbConcurrency = {version: 1, queuedQueries: 512};
    } else if (d.id === sessions.id) {
      restored.resources.find(r => r.id === "lb")!.autoscaling!.minReplicas = 12;
      // Adding app CPU does not close per-instance database sessions.
      near.resources.find(r => r.id === "app")!.skuId = "m5.2xlarge";
    } else {
      delete restored.resources.find(r => r.id === "db")!.skuId;
      Object.assign(near.resources.find(r => r.id === "db")!, {
        databaseReplication: {version: 1, enabled: true, replicationDelayMs: 1000, readPolicy: "primary"},
        databaseReadRouting: {version: 1, policy: "replica-preferred"},
      });
    }
    expect(restored).toEqual(start);
    expect(captureRunInputs(start, d.workload, challengeSeed(d)).workloadProfile).toEqual(captureRunInputs(fixed, d.workload, challengeSeed(d)).workloadProfile);
    for (const design of [start, fixed, near]) expect(preflight(d, design).valid).toBe(true);
    const beforeRow = run(d, start), afterRow = run(d, fixed), wrongRow = run(d, near);
    const before = buildRunReport(beforeRow), after = buildRunReport(afterRow), wrong = buildRunReport(wrongRow);
    expect(before.challenge!.status).toBe("not-met");
    expect(after.challenge!.status).toBe("met");
    expect(after.challenge!.criteria.every(c => c.status === "met")).toBe(true);
    expect(wrong.challenge!.status).toBe("not-met");
    expect(after.challenge!.predictions.every(p => p.actual !== null)).toBe(true);
    for (const row of [beforeRow, afterRow, wrongRow]) {
      const report = buildRunReport(row), raw = row.terminalSnapshot as SimulationSnapshot;
      // These exact captured counters survive server report validation, rather than being inferred from design.
      expect(db(report).database).toEqual(raw.metrics.db!.database);
      expect(db(report).databaseReplication).toEqual(raw.metrics.db!.databaseReplication);
    }
    if (d.id === reads.id) {
      const a = db(before), b = db(after), routeA = a.database!.readRouting!, routeB = b.database!.readRouting!;
      expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(1000);
      expect(after.terminal!.traffic!.latencyMs.p95!).toBeLessThan(15);
      expect(after.terminal!.traffic!.completedRps).toBeGreaterThan(before.terminal!.traffic!.completedRps);
      expect(after.terminal!.traffic!.failedRps).toBe(0);
      expect(a.databaseReplication!.primaryReads!).toBeGreaterThan(3000);
      expect(a.databaseReplication!.replicaReads).toBe(0);
      expect(b.databaseReplication!.primaryReads).toBe(0);
      expect(b.databaseReplication!.replicaReads!).toBeGreaterThan(5000);
      expect(b.databaseReplication!.primaryCommittedWrites!).toBeGreaterThan(1700);
      expect(b.databaseReplication!.replicaCommittedWrites).toBe(0);
      expect(routeA.members.primary.consumedCoreUs).toBeGreaterThan(5_900_000);
      expect(routeA.members.replica.consumedCoreUs).toBe(0);
      expect(routeB.members.primary.consumedCoreUs).toBeLessThan(routeA.members.primary.consumedCoreUs * 0.7);
      expect(routeB.members.replica.consumedCoreUs).toBeGreaterThan(5_000_000);
      expect(routeA.members.primary.queued).toBeGreaterThan(0);
      expect(routeB.members.primary.queued + routeB.members.replica.queued).toBe(0);
      expect(routeB.staleReads).toBeGreaterThan(0);
      expect(routeB.maxStaleReadAgeMs).toBeGreaterThan(900);
      expect(b.databaseReplication!.pendingReplication!).toBeGreaterThan(0);
      expect(b.databaseReplication!.staleReplicaReads).toBe(routeB.staleReads);
      expect(wrong.terminal!.traffic!.latencyMs.p95).toBe(before.terminal!.traffic!.latencyMs.p95);
      // Aggregate CPU/health can hide saturation of just the primary.
      expect(a.cpu).toBe(50); expect(a.health).toBe("healthy");
    } else if (d.id === sessions.id) {
      expect(db(before).connections).toBe(85); expect(db(after).connections).toBe(40);
      expect(db(before).database!.sessionRefused!).toBeGreaterThan(300);
      expect(db(after).database!.sessionRefused).toBe(0);
      expect(db(wrong).connections).toBe(85);
      expect(before.terminal!.pools!.lb!.currentReplicas).toBe(12);
      expect(after.terminal!.pools!.lb!.currentReplicas).toBe(4);
      expect(after.terminal!.pools!.lb!.maxReplicas).toBe(12);
      expect(db(before).health).toBe("healthy"); expect(db(after).health).toBe("healthy");
      expect(after.terminal!.traffic!.completedRps).toBe(300);
      expect(after.terminal!.traffic!.latencyMs.p95).toBe(before.terminal!.traffic!.latencyMs.p95);
      expect(after.terminal!.traffic!.wholeRun!.failed).toBeGreaterThan(0);
      expect(after.terminal!.traffic!.wholeRun!.failed).toBeLessThan(before.terminal!.traffic!.wholeRun!.failed);
      expect(after.terminal!.traffic!.wholeRun!.percentiles.p95!.lowMs!).toBeGreaterThan(before.terminal!.traffic!.wholeRun!.percentiles.p95!.highMs!);
      for (const mutate of [
        (row: typeof afterRow) => { row.actions = []; },
        (row: typeof afterRow) => { row.actions![0]!.completedSimulatedSeconds = null; },
        (row: typeof afterRow) => { row.challengeScenario = null; },
      ]) {
        const row = structuredClone(afterRow); mutate(row);
        expect(["not-evaluated", "unavailable"]).toContain(buildRunReport(row).challenge!.status);
      }
      const missingTarget = structuredClone(start); missingTarget.resources = missingTarget.resources.filter(r => r.id !== "db");
      expect(preflight(d, missingTarget).valid).toBe(false);
    } else {
      expect(db(before).cpu).toBe(100); expect(db(after).cpu).toBe(65);
      expect(before.terminal!.traffic!.latencyMs.p95!).toBeGreaterThan(1000);
      expect(after.terminal!.traffic!.latencyMs.p95!).toBeLessThan(15);
      expect(after.terminal!.traffic!.completedRps).toBe(650);
      expect(wrong.terminal!.traffic).toEqual(before.terminal!.traffic);
      expect(db(wrong).databaseReplication!.primaryCommittedWrites).toBe(before.terminal!.traffic!.wholeRun!.completed);
      expect(db(wrong).databaseReplication!.replicaCommittedWrites).toBe(0);
      // Four startup health probes account for replica reads; applications still only write.
      expect(db(wrong).databaseReplication!.replicaReads).toBe(4);
      expect(db(wrong).database!.readRouting!.members.primary.consumedCoreUs).toBeGreaterThan(5_900_000);
      expect(db(wrong).cpu).toBe(50); expect(db(wrong).health).toBe("healthy");
      expect(after.terminal!.traffic!.failedRps).toBe(0);
    }
    console.info(JSON.stringify({lab: d.id, before: summary(before), after: summary(after), nearMiss: summary(wrong)}));

    const scored = d.id === sessions.id ? "connections" : "latency";
    for (const mutate of [
      (row: typeof afterRow) => { row.terminalSnapshot = null; },
      (row: typeof afterRow) => { (row.terminalSnapshot as SimulationSnapshot).simulatedSeconds--; },
      (row: typeof afterRow) => { (row.terminalSnapshot as {metricsTopologyRevision: number}).metricsTopologyRevision = 1; },
      (row: typeof afterRow) => { const s = row.terminalSnapshot as SimulationSnapshot; if (scored === "connections") delete s.metrics.db!.connections; else delete s.traffic; },
    ]) {
      const row = structuredClone(afterRow); mutate(row);
      expect(buildRunReport(row).challenge!.criteria.find(c => c.id === scored)!.status).toBe("not-evaluated");
    }
    const mismatch = structuredClone(afterRow); mismatch.challengeSpecHash = "0".repeat(64);
    expect(buildRunReport(mismatch).challenge!.status).toBe("unavailable");
  }, 120000);
});

test("database report evidence stays absent for legacy captures and refuses malformed counters", () => {
  const row = run(reads, REFERENCE[reads.id]!);
  const snapshot = (r: typeof row) => r.terminalSnapshot as SimulationSnapshot;
  const legacy = structuredClone(row); delete snapshot(legacy).metrics.db!.database; delete snapshot(legacy).metrics.db!.databaseReplication;
  expect(db(buildRunReport(legacy)).database).toBeUndefined();
  expect(db(buildRunReport(legacy)).databaseReplication).toBeUndefined();
  expect(buildRunReport(legacy).challenge!.status).toBe("met"); // Existing p95 criterion does not infer routing.
  for (const bad of [-1, null, Number.MAX_SAFE_INTEGER + 1, "unknown"]) {
    const corrupt = structuredClone(row);
    (snapshot(corrupt).metrics.db!.database!.readRouting!.members.primary as unknown as Record<string, unknown>).admitted = bad;
    expect(buildRunReport(corrupt).terminal).toBeNull();
    expect(buildRunReport(corrupt).challenge!.criteria.find(c => c.id === "latency")!.status).toBe("not-evaluated");
  }
}, 120000);
