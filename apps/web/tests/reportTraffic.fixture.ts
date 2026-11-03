import type { ReportCheckpoint, RunReport } from "@infraforge/contracts/reports";

export const recordedTraffic: NonNullable<ReportCheckpoint["traffic"]> = {
  offeredRps: 103, completedRps: 100, failedRps: 3, latencyMs: { p50: 2, p95: 8, p99: 13 },
  clientRetry: { originalsOffered: 500, totalAttempts: 600, retriesScheduled: 100, retriesIssued: 100,
    recovered: 70, exhausted: 20, givenUp: 10, attemptRps: 120, extraLoadFactor: 1.2,
    attemptsTimedOut: 30, wastedCompletions: 4, ineligibleByReason: {}, perAttemptOutcomes: [] },
  objective: { version: 1, objective: { version: 1, maxResponseMs: 10, targetSuccessPercent: 95 },
    throughUs: 5_000_000, horizonUs: 5_000_000, offered: 500, good: 450, late: 20, failed: 10,
    deadlineExceeded: 5, abandoned: 5, unresolvedPastThreshold: 5, pending: 5, status: "missed",
    measuredFraction: 0.9, worstCaseFraction: 0.9, bestCaseFraction: 0.91 },
  latency: { version: 2, window: { fromUs: 4_000_000, toUs: 5_000_000 }, status: "complete", sampleCap: 10000,
    completedCount: 100, failedCount: 3, cancelledCount: 0, inFlightCount: 5, rootBoundaryExceededCount: 0, p99Ms: 13,
    typical: { sampleCount: 100, totalMs: 4, categories: { applicationService: { meanMs: 3, share: 0.75 } }, unattributed: { meanMs: 1, share: 0.25 } },
    slowestOnePercent: { sampleCount: 1, totalMs: 13, categories: {}, unattributed: { meanMs: 13, share: 1 } },
    unproven: "Missing boundaries and load-balancer retry backoff remain unattributed; dependency time includes its nested network and service, without database internals." },
};

export const trafficReport: RunReport = {
  version: 1, run: { id: "a", infrastructureId: null, infrastructureName: "Traffic run", status: "torn-down",
    createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:05.000Z", resourceCount: 1,
    workload: null, workloadSource: "unavailable", chaosEventCount: 0, topologyRevision: 0, hasReportData: true },
  originalSeed: null, legacySeed: null, stages: [], timeline: [], chaosEvents: [],
  topology: { original: null, accepted: null, changes: null }, terminal: { resources: [], simulatedSeconds: 5, traffic: recordedTraffic },
  checkpoint: null, actions: [], provenance: { inputVersion: 2, simulationModelVersion: "2", catalogSnapshot: null },
  observed: [], interpreted: [], unknown: [], inspectNext: [],
};
