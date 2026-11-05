import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const leaveTimeToAcknowledgeV1: ChallengeDefinition = {
  engine: "2", id: "leave-time-to-acknowledge", version: 1, title: "Leave time to acknowledge", difficulty: "core",
  summary: "An object effect can finish while its message lease expires. Leave time for the delayed acknowledgement.",
  concepts: ["Visibility timeout", "Redelivery", "Acknowledgements"],
  story: ["The worker spends 250 CPU milliseconds per job and delays acknowledgement by 2000 milliseconds after writing the result.",
    "The queue's one-second visibility timeout expires first. A late receipt cannot remove the message; another delivery can repeat the object effect."],
  objective: "By second 15, acknowledge at least three originals, leave no outstanding messages and record no redeliveries.",
  workload: {targetThroughput: 12, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.8, payloadSize: "light"},
  workloadNote: "One upload every five seconds; the worker retains its single prefetch credit while waiting to acknowledge.",
  evaluationSeconds: 15, evaluationNote: "Cumulative queue work through second 15; object effects, deliveries and acknowledgements are separate populations.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "queue-work", label: "Acknowledge three; leave no outstanding messages or redeliveries", resourceId: "queue", minAcknowledged: 3, maxOutstanding: 0, maxRedeliveries: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 15?"}],
  hints: ["Compare originals, deliveries, object effects and acknowledgements. An effect does not end the lease.",
    "The saved acknowledgement delay starts after the result write. Visibility must cover that delay and the preceding processing and transport.",
    "Try five seconds of visibility on queue. Keep processing, acknowledgement delay, prefetch and delivery limit unchanged."],
  debrief: ["An expired delivery has a stale receipt. Repeating the result write is a new object effect on the same logical result key; it is not a new original upload.",
    "Longer visibility can let this delayed acknowledgement complete. It does not create exactly-once processing, physical durability or application transaction guarantees. This worker has no idempotency protection enabled.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0], ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 1, maxReceives: 3, retentionSeconds: 300}}],
    ["worker", "Virtual Machine", 2, 0, {asyncWorker: {enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 250, acknowledgementDelayMs: 2000}}], ["store", "Object Storage", 1, 2]],
  [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
