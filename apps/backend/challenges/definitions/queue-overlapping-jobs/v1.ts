import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const queueOverlappingJobsV1: ChallengeDefinition = {
  engine: "2", id: "queue-overlapping-jobs", version: 1, title: "Queue overlapping jobs", difficulty: "core",
  summary: "A slow first invocation overlaps later triggers. Preserve every job while bounding downstream concurrency.",
  concepts: ["Scheduler overlap", "Delayed starts", "Function throttling", "Database calls"],
  story: ["Timer triggers twenty read jobs, starting at 100 ms and repeating every 50 ms. The function takes 300 ms to initialize a cold instance and 100 ms to execute before querying db. Four invocations can be active at once.",
    "The allow policy lets up to 32 scheduler jobs compete for those four slots. A separate one-call/s foreground workload also reaches the function. Every duration and capacity here is an educational assumption."],
  objective: "Complete all twenty scheduled jobs by second 4 with no missed jobs and no active, queued or retained-latest jobs remaining.",
  workload: {targetThroughput: 60, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "One foreground read/s plus twenty timer reads at 50 ms intervals. Foreground caller latency does not count scheduled completions.",
  evaluationSeconds: 4, evaluationNote: "Cumulative timer ownership and attempt counters through second 4; inspect start delay and downstream function pressure separately.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "jobs", kind: "scheduler-work", label: "Complete twenty scheduled jobs with none missed or outstanding", resourceId: "timer", minCompleted: 20, maxMissed: 0, maxOutstanding: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "Can terminal health be Healthy even when earlier scheduled jobs were missed?"}],
  hints: ["Inspect timer completions and missed jobs, then function throttles and cold starts. Healthy terminal CPU cannot count work that was already lost.",
    "Skip avoids overlap by dropping triggers. More attempts can repeat work; the first slow invocation still overlaps later due times.",
    "Change only timer overlap from allow to queue. Its existing capacity of 32 and lateness allowance of 10000 ms can retain this finite burst."],
  debrief: ["Queue runs one timer job at a time and delays later starts. Saved attempt accounting records the delay; function counters record fewer cold instances and no throttles. The unchanged foreground workload still owns its own four caller completions.",
    "Skip is a plausible alternative when missed jobs are acceptable, but fails this preserve-all-work objective. A bounded queue can itself fill or expire jobs under sustained load. No exact scheduling, idempotency, exactly-once effects or production availability is established.", MODEL_NOTE],
  starter: starter([["timer", "Scheduler", 0, 1, {scheduler: {version: 1, startMs: 100, periodMs: 50, maxTriggers: 20, overlap: "allow", maxConcurrent: 32, queueCapacity: 32, maxAttempts: 1, timeoutMs: 5000, maxLatenessMs: 10000, operation: "read"}}],
    ["fn", "Serverless Function", 1, 0, {serverless: {version: 1, concurrency: 4, initializationMs: 300, durationMs: 100, timeoutMs: 2000}}], ["db", "Database", 2, 0]],
  [["timer", "fn"], ["fn", "db"]]),
};
