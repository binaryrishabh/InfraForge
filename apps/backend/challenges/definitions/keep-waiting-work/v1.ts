import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const keepWaitingWorkV1: ChallengeDefinition = {
  engine: "2", id: "keep-waiting-work", version: 1, title: "Keep waiting work", difficulty: "starter",
  summary: "A queue has room for a burst, but waiting messages expire before its worker can finish them.",
  concepts: ["Waiting work", "Message retention", "Publishing versus processing"],
  story: ["An upload app publishes one message per second, rising to four per second from seconds 120 to 140. One worker processes jobs in order. The queue already has room for the burst.",
    "The queue keeps each message for only one second. That clock keeps running while work waits and while the worker processes it. Change only how long messages may stay."],
  objective: "By second 170, acknowledge at least 210 messages, with at most 20 outstanding and no redeliveries.",
  workload: {targetThroughput: 60, throughputUnit: "per-minute", trafficShape: "peak", peakMultiplier: 4, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "One upload/s; four/s during the modeled 120-140s burst. The worker spends an authored 500 CPU milliseconds per job, with one job at a time.",
  evaluationSeconds: 170,
  evaluationNote: "Queue counters cover start through second 170. Ready messages and oldest ready age describe only this sample, not a drain-time guarantee.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "queue-work", label: "Acknowledge 210; at most 20 outstanding, without redelivery", resourceId: "queue", minAcknowledged: 210, maxOutstanding: 20, maxRedeliveries: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "Will overall health alone tell you whether waiting messages expired? Predict health at second 170."}],
  hints: ["Compare acknowledged and expired messages. Producer completions confirm publishing, not finished background work.",
    "An empty queue can mean the worker finished, or that messages expired. More queue space does not extend their lifetime.",
    "Select queue. In Upload queue, change Message retention (seconds) from 1 to 60. Keep the worker and queue capacity unchanged."],
  debrief: ["The starter accepts the uploads but expires messages before their acknowledgements. Extending retention lets that same worker keep processing the burst's waiting work. Ready depth and oldest ready age can be higher in the passing run because work is still waiting instead of disappearing.",
    "This differs from a full queue refusing publishes and from optimizing a worker: the queue already has space, and worker speed stays fixed. Inspect expired, acknowledged and ready messages together; low depth alone is not success.",
    "Retention covers in-flight messages too. Result writes can finish after their message expires, so finished jobs and acknowledgements are different counters. No physical durability, exactly-once effect or continuous-health guarantee is modeled. Next try Keep up with the queue to investigate a worker that cannot keep up.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0],
    ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 1, capacityMessages: 100}}],
    ["worker", "Virtual Machine", 2, 0, {asyncWorker: {enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 500}}],
    ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
