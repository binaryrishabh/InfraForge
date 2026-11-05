import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const traceASaturationCascadeV1: ChallengeDefinition = {
  engine: "2", id: "trace-a-saturation-cascade", version: 1, title: "Trace a saturation cascade", difficulty: "advanced",
  summary: "Follow database CPU saturation through occupied sessions, connection wait and failed callers. Change the constrained tier.",
  concepts: ["Saturation cascade", "Connection wait", "Completion tail", "Measurement populations"],
  story: ["800 requests/s are evenly split between reads and writes. The app has four educational cores; db has one. Reads require 1 ms of DB CPU, writes 2 ms. Persistent connections can remain occupied by work waiting for execution.",
    "The load balancer records failures while app CPU has spare capacity. Inspect DB waiting work, total connection-wait contribution, final p95 and whole-run callers together. Do not label all waiting as database session refusal."],
  objective: "Complete second-6 requests with p95 at most 20 ms and keep database health Healthy at that second. Explain the resulting pressure on the app as well.",
  workload: {targetThroughput: 48000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.5, payloadSize: "light"},
  workloadNote: "800 requests/s, half reads, half writes. App CPU assumptions: 3 ms/read, 6 ms/write. DB: 1 ms/read, 2 ms/write; ten-session lazy pool.",
  evaluationSeconds: 6, evaluationNote: "DB health and p95 are second-6 measurements. Whole-run caller counts are cumulative. No scripted fault, session outage or recovery-time claim.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 20 ms in second 6", maxMs: 20},
    {id: "database", kind: "database-healthy", label: "Database health is Healthy in second 6"}],
  predictions: [{id: "busy", kind: "busiest-type", prompt: "Which resource type records the highest known CPU at second 6?"},
    {id: "health", kind: "overall-health", prompt: "What overall health remains at second 6 when the constrained tier changes?"}],
  hints: ["Read DB CPU, serving and waiting statements, open sessions and session refusals. Then inspect completed callers' connection-wait contribution and whole-run failed callers.",
    "Changing app CPU cannot add DB execution capacity. Zero session refusals does not imply zero waiting: admitted sessions can still be occupied by work waiting for CPU.",
    "Change only db to db.m5.large, with two educational CPU cores. Keep traffic, the app and retries fixed. Explain why the app may become busier after the DB bottleneck is relieved."],
  debrief: ["The controlled comparison changes only the database tier. The starter saturates DB CPU and retains waiting statements; transport connection wait dominates completed callers' typical latency breakdown. The larger tier removes that wait in this workload and changes caller outcomes.",
    "Connection-wait attribution aggregates transport paths. It does not assign every waiting millisecond to one DB pool. Both runs have zero DB session refusals: this is CPU/occupied-connection pressure, not exceeding a session ceiling. App queue and retry amplification must not be asserted without their counters.",
    "After relief, app CPU increases because more work completes. The passing design need not have Healthy overall health: the database and completion-tail requirements have narrower scope. p95 omits failed and unfinished callers, covers only second 6 and proves no whole-run SLO.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60},
    retry: {enabled: true, maxAttempts: 4, backoffMs: 1, jitterRatio: 0.2, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"]}}],
  ["app", "Virtual Machine", 1, 0, {size: "large", vmExecution: {version: 1, workers: 64, queuedRequests: 256}}], ["db", "Database", 2, 0, {size: "small"}]], [["lb", "app"], ["app", "db"]]),
};
