import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";

export const keepAFunctionWarmV1: ChallengeDefinition = {
  engine: "2", id: "keep-a-function-warm", version: 1, title: "Keep a function warm", difficulty: "core",
  summary: "Sparse calls repeatedly initialize a function. Distinguish idle expiry from a concurrency ceiling.",
  concepts: ["Warm reuse", "Idle expiry", "Cold initialization", "Concurrency versus retention"],
  story: ["A function receives one call per second. Each cold instance initializes for 600 ms and runs a 10 ms body. Successful instances expire after only 100 ms idle. Each call also queries a lightly loaded database; invocations do not overlap.",
    "Predict final overall health, run unchanged and keep the report. Inspect Cold starts, Warm starts, Idle instances expired, Initialization time and Completed invocations. Healthy does not mean initialization overhead is small."],
  objective: "Through second 8, complete at least 7 invocations with at most 2 cold starts and no unsuccessful invocations. Change one saved setting and explain the recorded reuse.",
  workload: {targetThroughput: 60, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Fixed one read invocation/s, no random arrivals. Initialization 600 ms, body 10 ms; elapsed model assumptions, not provider timings.",
  evaluationSeconds: 8,
  evaluationNote: "Cumulative invocation counts through second 8. Initialization phase time includes active work; final-second latency is not a whole-run SLO.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Pass deployment checks"},
    {id: "reuse", kind: "function-reuse", label: "Complete 7 invocations with at most 2 cold starts and no unsuccessful invocations", resourceId: "fn", minCompleted: 7, maxColdStarts: 2, maxUnsuccessful: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded when every call finishes but each new instance pays initialization?"}],
  hints: ["Compare completed calls and throttles with cold starts and idle expiries. A concurrency ceiling only refuses overlapping work; it does not retain idle instances.",
    "Select fn. Change only Warm instance idle expiry (ms) from 100 to 5000. Keep concurrency, initialization, body, timeout and workload fixed. Review one change and compare saved reports.",
    "For a separate near miss, return to the starter and raise only Concurrent invocations from 1 to 16. Compare cold starts, expiries and initialization time before explaining why the extra ceiling did not help."],
  debrief: ["The short idle expiry discards a successful instance before the next sparse call. A longer expiry allows that call to reuse the idle instance, avoiding another initialization. The first invocation still starts cold.",
    "Increasing concurrency alone leaves idle expiry unchanged. With no overlap or throttles, a higher ceiling cannot prevent the instance from expiring. The controlled comparison attributes the observed reuse to one saved retention change.",
    "Both designs can complete every caller and remain Healthy. Inspect cold and warm counts, expired instances and cumulative initialization time rather than treating health or a final-second percentile as a whole-run efficiency or latency claim.",
    "This deterministic InfraForge model uses one invocation per instance and authored elapsed durations. Idle expiry is a teaching control, not a promise that a provider lets users choose exact warm retention. CPU, memory, warm-instance cost, eviction, prewarming and availability guarantees are Unknown or unmodeled. Missing observations stay Unknown and unscored."],
  starter: starter([["fn", "Serverless Function", 0, 0, {serverless: {version: 1, concurrency: 1, initializationMs: 600, durationMs: 10, timeoutMs: 2000, idleExpiryMs: 100}}], ["db", "Database", 1, 0]], [["fn", "db"]]),
};
