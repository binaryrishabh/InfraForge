import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const openOneSubscriberV1: ChallengeDefinition = {
  engine: "2", id: "open-one-subscriber", version: 1, title: "Open one subscriber", difficulty: "core",
  summary: "One Event Bus subscriber refuses transport while the other keeps processing. Repair the closed listener.",
  concepts: ["Event fan-out", "Subscriber isolation", "Listener admission"],
  story: ["The app publishes two events per second to bus, which dispatches independently to two queues.",
    "Queue has no allowed listener ports. Its subscription exhausts retries, while queue2 and worker2 can still complete their own work."],
  objective: "By second 12, each queue must acknowledge at least 20 messages with no outstanding work or redeliveries.",
  workload: {targetThroughput: 120, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.8, payloadSize: "light"},
  workloadNote: "Two upload events each second, independently fanned out to queue and queue2; three dispatch attempts per subscriber.",
  evaluationSeconds: 12, evaluationNote: "Inspect each subscription's delivery failures and each queue's work counters through second 12.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "queue-work", label: "Queue: acknowledge 20 without outstanding work or redeliveries", resourceId: "queue", minAcknowledged: 20, maxOutstanding: 0, maxRedeliveries: 0},
    {id: "other", kind: "queue-work", label: "Queue2: acknowledge 20 without outstanding work or redeliveries", resourceId: "queue2", minAcknowledged: 20, maxOutstanding: 0, maxRedeliveries: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 12?"}],
  hints: ["Inspect bus subscription counters individually. A producer success does not prove that both subscribers received the event.",
    "Queue2 already receives events. Raising bus attempts cannot open the other queue's closed transport listener.",
    "Select queue. Allow listener port 5672, matching bus-queue. Keep the bus and both workers unchanged."],
  debrief: ["Each subscription owns its pending deliveries and retry limit. A refused transport on one subscriber does not serialize the other subscriber behind it.",
    "Bus dead letters describe exhausted dispatches. Queue dead letters describe exhausted consumer deliveries; they are separate. Opening this listener changes admission, not consumer CPU or bus retry capacity.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 1], ["bus", "Event Bus", 1, 1, {eventBus: {version: 1, retryDelayMs: 100, maxAttempts: 3}}],
    ["queue", "Message Queue", 2, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300}, listenerSettings: {version: 1, ports: []}}],
    ["queue2", "Message Queue", 2, 2, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300}}],
    ["worker", "Virtual Machine", 3, 0, {asyncWorker: {enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 250}}],
    ["worker2", "Virtual Machine", 3, 2, {asyncWorker: {enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 250}}], ["store", "Object Storage", 4, 1]],
  [["app", "bus"], ["app", "store"], ["bus", "queue"], ["bus", "queue2"], ["queue", "worker"], ["queue2", "worker2"], ["worker", "store"], ["worker2", "store"]]),
};
