import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const notificationRetryStormV1: ChallengeDefinition = {
  engine: "2", id: "notification-retry-storm", version: 1, title: "Mission: notification retries", difficulty: "advanced",
  summary: "Stop undeliverable notification requests from using the worker time that good notifications need.",
  concepts: ["Poison messages", "Delivery limit", "Dead-letter queue", "Retry cost"],
  story: ["A notification service accepts eight requests each second. Each one is modeled as an object upload followed by a queue publish. A background worker reads the request, spends CPU on it and writes a result object that stands for a sent notification.",
    "One request in five cannot be sent, for example because its address is invalid. The worker fails it after the read and CPU work, and the queue delivers it again until the delivery limit is reached. The starter allows ten deliveries per message, so each bad request keeps taking worker time.",
    "Educational assumptions: one worker core, eight concurrent jobs and 80 CPU milliseconds per job. Delivery to a real email or SMS provider, recipient rules, ordering and duplicate-send protection are conceptual only; this mission does not verify them."],
  objective: "At second 60, acknowledge at least 350 messages, leave at most 10 outstanding, record at most 250 redeliveries and report Healthy overall health.",
  workload: {targetThroughput: 480, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Educational steady load of eight requests/s. The bad share is a fixed saved setting applied by the engine to requests chosen from the run's seed.",
  evaluationSeconds: 60, evaluationNote: "Queue counters are cumulative from the start through second 60. The redelivery limit is an authored retry-waste budget, not a provider rule.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "queue-work", label: "Acknowledge 350; at most 10 outstanding and 250 redeliveries by second 60", resourceId: "queue", minAcknowledged: 350, maxOutstanding: 10, maxRedeliveries: 250},
    {id: "health", kind: "overall-health", label: "Overall modeled health is Healthy at second 60", allowed: ["healthy"]}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 60?"}],
  hints: ["Compare acknowledged messages with deliveries and redeliveries. Producer completions only prove that requests were accepted.",
    "A bad request is delivered again each time the worker fails it, until the queue's delivery limit. Faster or larger workers also spend their capacity on those repeats.",
    "Lower only the queue's maximum deliveries from ten to a small number. Keep worker CPU work, concurrency, size and the bad-request share unchanged, and check the dead-lettered count."],
  debrief: ["Each failed delivery costs the worker a read and CPU work. With a high delivery limit, repeats of bad requests compete with good requests for the same core, so acknowledged work falls behind and backlog stays. A low limit moves a bad request to the dead-letter queue sooner.",
    "A bigger worker can absorb the repeats and still pass the backlog check, but it does so by repeating failed work many more times, which breaks the authored redelivery budget. Dead-lettering keeps the failed requests for inspection; this model does not replay, alert or repair them.",
    "Not verified: real provider delivery, recipient validity, ordering, duplicate sends for good messages, rate limits, user consent, payments, distributed transactions or production availability. The bad share is an assumed input, not a measured failure rate.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0],
    ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 10, retentionSeconds: 300}}],
    ["worker", "Virtual Machine", 2, 0, {asyncWorker: {enabled: true, concurrency: 8, prefetch: 8, cpuMsPerJob: 80, badJobPercent: 20}}],
    ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
