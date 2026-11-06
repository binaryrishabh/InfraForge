import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const analyticsBurstBufferV1: ChallengeDefinition = {
  engine: "2", id: "analytics-burst-buffer", version: 1, title: "Mission: analytics burst", difficulty: "advanced",
  summary: "Give an analytics intake enough waiting room for a finite burst without losing events at the producer.",
  concepts: ["Queue capacity", "Load shedding", "Buffer versus drain rate", "Producer failures"],
  story: ["An analytics intake receives five events each second, and twenty each second from second 120 until 140. Each event is modeled as an object write followed by a queue publish. One worker with 80 CPU milliseconds per job writes a result object for each event.",
    "The queue holds at most 50 waiting messages. When it is full it refuses new publishes, so the producer fails those requests and the events never enter the pipeline. The worker's drain rate is fixed in this mission and is below the burst rate.",
    "No database write is modeled. A processed event is only a result object, so database throughput, event ordering, unique event IDs and exactly-once counting are conceptual and are not verified here."],
  objective: "At second 170, acknowledge all 1150 offered events and leave at most 10 outstanding messages, with no more than 10 redeliveries.",
  workload: {targetThroughput: 300, throughputUnit: "per-minute", trafficShape: "peak", peakMultiplier: 4, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Educational events: 5/s, 20/s at 120-140, then 5/s. Producer completion is queue acceptance; a refused publish is a failed producer request.",
  evaluationSeconds: 170, evaluationNote: "Queue counts cover start through second 170. Acknowledging every offered event means none were refused at the producer.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "queue-work", label: "Acknowledge 1150; at most 10 outstanding and 10 redeliveries by second 170", resourceId: "queue", minAcknowledged: 1150, maxOutstanding: 10, maxRedeliveries: 10}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 170?"}],
  hints: ["Compare originals and acknowledged messages with the whole-run Failed count. Healthy overall health does not prove every event was accepted.",
    "A full queue refuses publishes at the producer. Extra waiting room helps only if it can hold the burst's excess and the worker can drain it afterwards.",
    "Increase only the queue's message capacity until the burst fits. Keep worker CPU work, concurrency and the workload unchanged, then try a capacity that is only a little larger."],
  debrief: ["During the burst events arrive faster than the worker can finish them. Waiting room stores the excess while the worker catches up after second 140. When the room is too small, the queue refuses publishes and the producer reports failures, so those events are lost before processing.",
    "Room that is only a little too small still loses events, and a large queue behind a worker that is too slow only moves the problem into backlog. A faster worker is another way to meet the same requirement, because it removes the excess instead of storing it.",
    "Not verified: database writes, ordering, unique event IDs, exactly-once counting, physical durability, producer-side retry or buffering, real analytics pipelines or production availability. Rates and capacities are educational inputs.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0],
    ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300, capacityMessages: 50}}],
    ["worker", "Virtual Machine", 2, 0, {asyncWorker: {enabled: true, concurrency: 8, prefetch: 8, cpuMsPerJob: 80}}],
    ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
