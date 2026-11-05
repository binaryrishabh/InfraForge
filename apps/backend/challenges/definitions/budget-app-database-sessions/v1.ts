import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const budgetAppDatabaseSessionsV1: ChallengeDefinition = {
  engine: "2", id: "budget-app-database-sessions", version: 1, title: "Budget app database sessions", difficulty: "core",
  summary: "A short database slowdown fills per-instance pools. Reduce the initial app count to leave session headroom.",
  concepts: ["Per-instance pools", "Database session limits", "Idle sessions"],
  story: ["Twelve app instances each own a lazy database pool of up to 10 connections. The selected database allows 85 sessions. At second 1, its CPU drops to 0.02 cores for two seconds, giving requests time to fill pools.",
    "By second 6, the slowdown has ended. Idle connections can remain open for ten seconds. A Healthy database and low current p95 do not prove spare session capacity or erase earlier refusals."],
  objective: "Leave strictly positive spare database sessions and complete requests with p95 at most 100 ms in second 6. Change the initial app count and compare recorded refusals.",
  workload: {targetThroughput: 18000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "300 reads/s, light payloads, 100 modeled keys. Pools open lazily, up to 10 sessions per app instance/path; idle timeout is 10 seconds.",
  evaluationSeconds: 6, evaluationNote: "CPU restores at 3,000,001 microseconds. Score sessions and completed-request p95 in second 6, with exact scenario application/end receipts required.",
  scenario: {version: 1, visibility: "revealed", steps: [{id: "db-slowdown", atSecond: 1,
    request: {interventionId: "cpu-capacity", revision: 1, target: {resourceId: "db"}, parameters: {cores: 0.02, duration: 2}}}]},
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "connections", kind: "database-connections", requireSpare: true, label: "Leave strictly positive spare database session capacity at second 6"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 100 ms in second 6", maxMs: 100}],
  predictions: [{id: "health", kind: "database-health", prompt: "At second 6, can the database be Healthy while all its session slots remain occupied?"}],
  hints: ["Read Connections alongside cumulative Session refusals and whole-run caller failures. Current p95 describes a different window.",
    "Twelve pools could open 120 sessions, exceeding 85. Four pools can open at most 40; neither number predicts actual lazy occupancy.",
    "Select lb. In Autoscaling pool, change Minimum from 12 to 4. Keep Maximum at 12, and keep the CPU target, database and workload unchanged."],
  debrief: ["Reducing only the initial app count bounds the number of independently owned pools. The database retains the same CPU and 85-session limit. Compare actual Connections and Session refusals rather than treating pool maxima as measured occupancy.",
    "This six-second experiment ends before the first ten-second autoscaler evaluation, so changing minimum replicas changes initial instances. It is not a long-run replica cap.",
    "Spare sessions and low second-6 p95 do not establish whole-run success. The reference still has failures during the slowdown and can have a worse whole-run latency tail. Idle sessions persist after work drains, and health alone does not describe connection headroom.",
    "Pool size is fixed in this canvas profile, so instance count is the supported lever. CPU restoration is a scripted capacity change, not database failover. Session limits and timings are educational assumptions.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60}, autoscaling: {enabled: true, minReplicas: 12, maxReplicas: 12, targetCpu: 80}}],
    ["app", "Virtual Machine", 1, 0, {size: "large"}],
    ["db", "Database", 2, 0, {skuId: "db.t3.micro", dataKeyspace: {version: 1, count: 100, accessPattern: "uniform"}}]],
  [["lb", "app"], ["app", "db"]]),
};
