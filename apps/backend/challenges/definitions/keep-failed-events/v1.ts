import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const keepFailedEventsV1: ChallengeDefinition = {
  engine: "2", id: "keep-failed-events", version: 1, title: "Keep failed events", difficulty: "core",
  summary: "When a subscriber keeps failing, the bus's dead-letter list is the only copy of what failed. A full list discards the rest.",
  concepts: ["Event bus dead letters", "Dead-letter capacity", "Silent discard", "One-change experiments"],
  story: ["An app publishes two events per second to a bus. One subscriber's queue refuses the bus's transport, so every dispatch to it fails and is retried until the attempt limit.",
    "The team will repair that subscriber later and wants every failed event kept for replay. The bus keeps exhausted events in a bounded dead-letter list."],
  objective: "By second 30, retain at least 50 exhausted events in the bus's dead-letter list and discard none because the list was full.",
  workload: {targetThroughput: 120, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.8, payloadSize: "light"},
  workloadNote: "Two events each second, steady. The subscriber's closed listener is a known fault of this exercise, not the thing to fix here.",
  evaluationSeconds: 30, evaluationNote: "Subscription counters are cumulative from the start through second 30.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "kept", kind: "bus-dead-letters", label: "Keep at least 50 failed events and discard none by second 30", resourceId: "bus", minDeadLettered: 50}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 30?"}],
  hints: ["Read each subscription's exhausted, dead-lettered and dead-letter overflow counts. Dispatches fail either way; the question is what is kept.",
    "More delivery attempts repeat failing dispatches but do not make the list any bigger.",
    "Select bus. Change only Dead letters per subscription. Keep delivery attempts, retry delay and the queue's closed listener unchanged."],
  debrief: ["Each exhausted dispatch moves to the bus's dead-letter list if there is room. When the list is full the event is discarded and counted as overflow, so the failure is invisible except in that counter.",
    "Raising delivery attempts only repeats failing dispatches, so the list still fills; a larger list keeps them. This lab keeps the subscriber broken on purpose; opening its listener is a different lesson.",
    "Not verified: durability of a real dead-letter store, replay tooling, ordering or alerting. Capacity is an educational limit.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 1], ["bus", "Event Bus", 1, 1, {eventBus: {version: 1, retryDelayMs: 100, maxAttempts: 3, deadLetterCapacity: 5}}],
    ["queue", "Message Queue", 2, 1, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300}, listenerSettings: {version: 1, ports: []}}],
    ["worker", "Virtual Machine", 3, 1, {asyncWorker: {enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 250}}], ["store", "Object Storage", 4, 1]],
  [["app", "bus"], ["app", "store"], ["bus", "queue"], ["queue", "worker"], ["worker", "store"]]),
};
