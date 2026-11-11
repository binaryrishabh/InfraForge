import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const traceABurstBacklogV1: ChallengeDefinition = {
  engine: "2", id: "trace-a-burst-backlog", version: 1, title: "Trace a burst backlog", difficulty: "advanced",
  summary: "A short burst fills the queue, the producer starts failing, and the lost events never come back. Find the first bottleneck.",
  concepts: ["Cascading failure", "Queue capacity", "Producer refusal", "Root cause versus symptom"],
  story: ["An app accepts uploads and publishes one event per upload to a queue. A worker spends CPU on each event. Between seconds 120 and 140 traffic rises sixfold.",
    "After the burst the worker catches up, yet many uploads failed and their events were never processed. Run unchanged and trace where the first bottleneck is, what it fed, and why a faster worker alone does not undo it."],
  objective: "At second 240, complete at least 1340 of the uploads with at most 20 unsuccessful, acknowledge at least 1340 messages and leave at most 10 outstanding. Change one setting.",
  workload: {targetThroughput: 240, throughputUnit: "per-minute", trafficShape: "peak", peakMultiplier: 6, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Educational upload events: 4/s, 24/s at 120-140, then 4/s. A refused publish fails the upload; its event is lost.",
  evaluationSeconds: 240, evaluationNote: "Cumulative caller outcomes and queue counts through second 240, one hundred seconds after the burst.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "callers", kind: "caller-outcomes", label: "Complete 1340 uploads with at most 20 unsuccessful through second 240", minCompleted: 1340, maxUnsuccessful: 20},
    {id: "work", kind: "queue-work", label: "Acknowledge 1340; at most 10 outstanding by second 240", resourceId: "queue", minAcknowledged: 1340, maxOutstanding: 10, maxRedeliveries: 5000}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 240?"}],
  hints: ["Compare uploads that failed with the queue's originals and acknowledged counts, and the worker's CPU. Find which resource is full when the first upload fails.",
    "A faster worker drains the backlog sooner but the queue is already full during the burst.",
    "Select queue. Change only Queue capacity (messages). Keep the worker, its CPU work and the workload unchanged."],
  debrief: ["During the burst events arrive faster than the worker can finish them, so the queue fills to its message limit. Once it is full each new publish is refused, the upload fails and its event is never created.",
    "A bigger worker or more parallel jobs drains the backlog sooner, but the burst still outruns it while the queue is at its limit, so uploads still fail. Room for the burst is what keeps the events.",
    "Not verified: real queue limits, producer retries or durability. The burst, capacity and CPU work are educational inputs.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0],
    ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300, capacityMessages: 100}}],
    ["worker", "Virtual Machine", 2, 0, {asyncWorker: {enabled: true, concurrency: 4, prefetch: 4, cpuMsPerJob: 125}}],
    ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
