import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const boundFunctionPoolPressureV1: ChallengeDefinition = {
  engine: "2", id: "bound-function-pool-pressure", version: 1, title: "Bound function pool pressure", difficulty: "advanced",
  summary: "Trade function concurrency for lower shared database-pool contention while retaining useful completions.",
  concepts: ["Cold starts", "Concurrency throttling", "Shared database pools", "Admission tradeoffs"],
  story: ["A read function receives 3000 calls/s. Each new instance initializes for 100 ms, executes for 100 ms and queries db. Its concurrency ceiling is 128. The source shares a lazy ten-session serial database pool.",
    "The generic database assumes one CPU core and 1 ms CPU/read. More warm instances can wait on that same bounded pool. Function timing and database capacity are educational assumptions, not provider benchmarks."],
  objective: "Through second 3, complete at least 800 invocations with no downstream failures and at most 8500 throttles; record completed-request p95 at most 110 ms in second 3.",
  workload: {targetThroughput: 180000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "3000 reads/s, light payloads. Requests over the concurrency ceiling are refused immediately, not queued inside the function.",
  evaluationSeconds: 3, evaluationNote: "Function counts cover start through second 3. Latency covers completions in second 3 only; inspect throttles and unfinished calls too.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "function-work", label: "Complete 800 invocations within the explicit refusal budget", resourceId: "fn", minCompleted: 800, maxThrottled: 8500, maxDownstreamFailed: 0},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 110 ms in second 3", maxMs: 110}],
  predictions: [{id: "health", kind: "database-health", prompt: "What database health will be recorded at second 3 with your function concurrency?"}],
  hints: ["Compare cold starts, function throttles, database CPU and sessions with the completed callers' connection-wait contribution. The function owns one shared database pool.",
    "Setting concurrency to one can make successful calls fast while rejecting almost everything. Reducing initialization alone cannot add pool or database capacity.",
    "Try changing only fn concurrency from 128 to 32. Keep initialization, duration, database and workload fixed; explain the extra refused calls as well as the shorter tail."],
  debrief: ["The smaller concurrency bound reduces admitted work, cold starts and pressure on the shared database path. It also increases throttling and reduces total completions. The minimum completion and maximum refusal requirements prevent a latency-only answer that admits almost no work.",
    "Warm function instances do not each own ten sessions here: the pool is shared per source path. Neither design exhausts the database's 100-session ceiling. This lab demonstrates contention, not session refusal. A session-capacity scenario is currently refused for this serving path.",
    "Initialization and body durations are elapsed assumptions, not CPU demands. The second-3 p95 is not a whole-run SLO; the passing design still refuses most offered calls and establishes no availability guarantee.", MODEL_NOTE],
  starter: starter([["fn", "Serverless Function", 0, 0, {serverless: {version: 1, concurrency: 128, initializationMs: 100, durationMs: 100, timeoutMs: 2000}}], ["db", "Database", 1, 0]], [["fn", "db"]]),
};
