import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const redriveAfterTheFixV1: ChallengeDefinition = {
  engine: "2", id: "redrive-after-the-fix", version: 1, title: "Redrive after the fix", difficulty: "advanced",
  summary: "Dead-lettered work comes back only when you redrive it. Redrive before the repair and the same messages fail again.",
  concepts: ["Dead-letter queue", "Redrive", "Repair before replay", "One-change experiments"],
  story: ["A notification worker fails one request in five because of a bug. The queue gives each message three deliveries, then moves it to the dead-letter list.",
    "The team will deploy a fix at second 30 and has scheduled one redrive of the dead-letter list at second 20. A redrive returns every dead-lettered message to the queue once, with its deliveries reset."],
  objective: "At second 90, acknowledge at least 700 messages and leave at most 10 outstanding. Compare one setting change.",
  workload: {targetThroughput: 480, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Eight requests/s, steady. The bad share is a fixed saved setting applied to requests chosen from the run's seed; the repair second stops those requests failing.",
  evaluationSeconds: 90, evaluationNote: "Queue counters are cumulative from the start through second 90.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "queue-work", label: "Acknowledge 700; at most 10 outstanding by second 90", resourceId: "queue", minAcknowledged: 700, maxOutstanding: 10, maxRedeliveries: 5000}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 90?"}],
  hints: ["Compare the dead-lettered count with acknowledged messages. A redrive is only useful if the next delivery can succeed.",
    "Look at when the repair happens relative to the redrive. Messages returned before the fix fail again and go back to the dead-letter list.",
    "Select queue. Change only Redrive at second from 20 to a second after the repair at 30. Keep the delivery limit and the worker unchanged."],
  debrief: ["A redrive moves dead-lettered messages back with fresh delivery counts. Before the repair at second 30 the cause is still present, so they fail three more times and are dead-lettered again. After the repair they succeed.",
    "Raising the delivery limit looks like a gentler fix, but it only repeats failing work earlier. The messages still fail until the repair and the dead-letter list is not drained by itself.",
    "Not verified: how a real team repairs, replays or alerts on a dead-letter queue, ordering, duplicate effects of replay, or availability. The repair is an authored second, not a measured recovery time.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0],
    ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300, redriveAtSecond: 20}}],
    ["worker", "Virtual Machine", 2, 0, {asyncWorker: {enabled: true, concurrency: 8, prefetch: 8, cpuMsPerJob: 20, badJobPercent: 20, repairAtSecond: 30}}],
    ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
