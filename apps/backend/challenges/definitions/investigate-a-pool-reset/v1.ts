import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const investigateAPoolResetV1: ChallengeDefinition = {
  engine: "2", id: "investigate-a-pool-reset", version: 1, title: "Investigate a pool reset", difficulty: "advanced",
  summary: "Reconstruct a database slowdown and a pool-reset attempt from exact receipts and the surviving caller evidence.",
  concepts: ["Incident investigation", "Attempted recovery", "Evidence gaps", "Retry pressure"],
  story: ["At second 2 the script reduces db to 0.02 CPU cores for three seconds. At second 3 an operator-style recovery attempt resets the app-db transport pool. That one-shot action does not end the CPU intervention.",
    "Build a short incident account: what failed, what happened next, affected paths, retained facts, missing measurements, attempted recovery and observed result. Use exact action receipts and the final report; preserve Unknown where intermediate samples are absent."],
  objective: "After both scripted actions finish, complete second-6 requests with p95 at most 2200 ms. Explain whole-run failures as well as the changed tail.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "200 reads/s, four-core app, 32 workers and 256 queue places, ten-session lazy dependency pool. Educational DB CPU drops to 0.02 cores.",
  evaluationSeconds: 6, evaluationNote: "CPU restores at 5,000,001 us. Pool reset is at 3,000,001 us. Both exact receipts and current terminal evidence are required.",
  scenario: {version: 1, visibility: "revealed", steps: [
    {id: "db-slowdown", atSecond: 2, request: {interventionId: "cpu-capacity", revision: 1, target: {resourceId: "db"}, parameters: {cores: 0.02, duration: 3}}},
    {id: "reset-pool", atSecond: 3, request: {interventionId: "pool-reset", revision: 1, target: {edgeId: "app-db", direction: "both"}, parameters: {}}},
  ]},
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 2200 ms in second 6", maxMs: 2200}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 6 after CPU capacity restores?"},
    {id: "database", kind: "database-health", prompt: "What DB health will be recorded at second 6? Does it erase earlier caller failures?"}],
  hints: ["Read the two action targets, application times, end times and end receipts. Reset completion is evidence of a pool reset, not evidence that CPU capacity returned then.",
    "Use whole-run completed, failed and in-flight callers alongside second-6 p95. There is no retained continuous scenario trace to establish immediate improvement after reset.",
    "Keep the incident fixed. Change only lb Maximum attempts from 4 to 2, then compare the tail and failed callers. Increasing attempts to 5 is a separate near miss."],
  debrief: ["The CPU intervention and pool reset are distinct actions. Their receipts establish their exact scope and order. The terminal snapshot establishes the later measured result. Neither supplies missing before/after-reset telemetry, so the reset's immediate service benefit remains Unknown.",
    "Reducing total attempts changes the response tail under the same incident, without making the reset restore CPU. The passing run still has failed callers. A shorter completed-request tail does not prove improved availability, all-request latency or continuous recovery.",
    "Write the account from your report, not invented alerts, logs, users or timestamps. The engine models CPU capacity, transport reset, deadlines and retries; it does not model an operator, DB process restart or packet capture. Your incident prose is not graded.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60},
    retry: {enabled: true, maxAttempts: 4, backoffMs: 1, jitterRatio: 0.2, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"]}}],
  ["app", "Virtual Machine", 1, 0, {size: "large", vmExecution: {version: 1, workers: 32, queuedRequests: 256}}], ["db", "Database", 2, 0]], [["lb", "app"], ["app", "db"]]),
};
