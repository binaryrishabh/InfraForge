import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const holdSlotsOnASlowCallV1: ChallengeDefinition = {
  engine: "2", id: "hold-slots-on-a-slow-call", version: 1, title: "Hold slots on a slow call", difficulty: "core",
  summary: "Jobs that mostly wait on an outside service keep a worker slot busy while CPU stays idle. Find the limit that is actually binding.",
  concepts: ["Held capacity", "Job parallelism", "Waiting versus CPU", "Backlog diagnosis"],
  story: [
    "Eight uploads arrive each second. A two-core worker spends 50 CPU milliseconds on each job, then waits 450 milliseconds on an assumed external service. It runs one job at a time and can lease eight messages.",
    "While a job waits it spends no CPU but keeps its parallel slot. Compare worker CPU with the queue backlog and work in progress before changing anything, and change only one setting.",
  ],
  objective: "At second 40, acknowledge at least 280 messages with at most 12 outstanding and no redeliveries.",
  workload: {targetThroughput: 480, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Eight uploads/s for the whole run. Job CPU and the external wait are educational inputs, not measured provider behaviour.",
  evaluationSeconds: 40, evaluationNote: "Counters cover start through second 40. Outstanding work is one sample at the end; no drain-time or whole-run wait guarantee follows.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "queue-work", label: "Acknowledge 280; at most 12 outstanding and no redeliveries", resourceId: "queue", minAcknowledged: 280, maxOutstanding: 12, maxRedeliveries: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 40? Does low worker CPU show the worker keeps up?"}],
  hints: ["Compare worker CPU with acknowledged work and total outstanding work. Idle CPU does not mean idle slots.",
    "One job at a time with a 500 ms cycle completes about two jobs a second, far below the eight arriving. Two parallel jobs (one per core) still fall short. A larger worker adds cores, not slots.",
    "Select worker. Under Background worker, change only Jobs in parallel from 1 to 4. Keep size, CPU milliseconds, external wait and prefetch credit fixed."],
  debrief: [
    "Each job occupies its slot for about 500 ms (50 ms CPU plus 450 ms wait), so one slot completes about two jobs a second against eight arriving. CPU stays low because waiting uses none, yet backlog grows.",
    "Four parallel jobs give about eight a second of slot capacity, which matches the arrivals, and the same two cores carry the CPU easily. That is more jobs in flight than cores, because a waiting job needs a slot but no core; two or three parallel jobs still leave a backlog. As a near miss, restore one parallel job and choose the larger worker size: the extra cores do not create slots, so the backlog and acknowledgements barely move.",
    "The external wait is an authored assumption, not a measured provider. The model has no connection pools, timeouts or retries on this call, and no ordering, durability or exactly-once guarantee follows. A fixed-second sample proves no continuous behaviour.",
    MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0],
    ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 120, maxReceives: 3, retentionSeconds: 300, capacityMessages: 1000}}],
    ["worker", "Virtual Machine", 2, 0, {size: "medium", asyncWorker: {enabled: true, concurrency: 1, prefetch: 8, cpuMsPerJob: 50, externalWaitMs: 450}}],
    ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
