import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const keepUpWithTheQueueV1: ChallengeDefinition = {
  engine: "2", id: "keep-up-with-the-queue", version: 1, title: "Keep up with the queue", difficulty: "core",
  summary: "A fast producer can hide a slow consumer. Measure acknowledged work and outstanding messages separately.",
  concepts: ["Consumer capacity", "Queue backlog", "CPU work"],
  story: ["The app accepts eight uploads each second. Its worker spends an authored 250 CPU milliseconds on each job, so work accumulates behind the producer.",
    "Change only the worker's CPU work per job. A larger queue can hold more waiting work but cannot process it."],
  objective: "By second 12, acknowledge at least 80 messages with at most 10 outstanding and no redeliveries.",
  workload: {targetThroughput: 480, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.8, payloadSize: "light"},
  workloadNote: "Eight upload requests per second; each producer completion confirms publishing, not consumer completion.",
  evaluationSeconds: 12, evaluationNote: "Queue counters cover run start through second 12. Outstanding means ready + in flight + scheduled.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "queue-work", label: "Acknowledge 80; leave at most 10 outstanding, without redelivery", resourceId: "queue", minAcknowledged: 80, maxOutstanding: 10, maxRedeliveries: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 12?"}],
  hints: ["Inspect outstanding messages and acknowledged work alongside producer completions.",
    "CPU work per job limits the worker even when publishing is fast. Increasing queue capacity leaves that work unchanged.",
    "Try 50 CPU milliseconds per job on worker; keep concurrency, prefetch and all other settings unchanged."],
  debrief: ["Producer completion means the object was uploaded and its message accepted. The queue still owns work until a valid acknowledgement.",
    "Reducing authored CPU work per job models an optimized worker. It is an input assumption, not a code optimizer or a measured cloud speedup. The comparison records outstanding work at the same second, not a burst drain time.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0], ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300}}],
    ["worker", "Virtual Machine", 2, 0, {asyncWorker: {enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 250}}], ["store", "Object Storage", 1, 2]],
  [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
