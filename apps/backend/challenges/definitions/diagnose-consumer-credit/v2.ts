import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const diagnoseConsumerCreditV2: ChallengeDefinition = {
  engine: "2", id: "diagnose-consumer-credit", version: 2, title: "Diagnose consumer credit", difficulty: "advanced",
  summary: "A slow consumer accumulates ready messages with spare CPU and no redelivery. Diagnose the credit held until acknowledgement.",
  concepts: ["Consumer credit", "Acknowledgement wait", "Backlog diagnosis", "Ready age observations"],
  story: ["Eight uploads arrive each second. The producer writes an object and publishes a message; the worker reads it, spends 20 CPU milliseconds, writes a result and waits 1500 milliseconds before acknowledging. The worker has one parallel job and one prefetch credit. There is no scripted outage.",
    "Run unchanged before editing. Inspect acknowledged, ready and in-flight messages and completed object effects alongside producer completions and worker CPU. Separate a slow consumer from a lease that expires before acknowledgement."],
  objective: "By second 12, acknowledge at least 80 messages, leave at most 16 outstanding and record no redeliveries. Diagnose first, then test one setting change.",
  workload: {targetThroughput: 480, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Eight uploads/s. CPU work and acknowledgement delay are educational inputs. Producer completion means publish acceptance, not job acknowledgement.",
  evaluationSeconds: 12, evaluationNote: "Cumulative queue counts through second 12; outstanding is ready + in flight + scheduled. Oldest ready age and worker phases are absent from saved requirement details.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "queue-work", label: "Acknowledge 80; at most 16 outstanding and no redeliveries by second 12", resourceId: "queue", minAcknowledged: 80, maxOutstanding: 16, maxRedeliveries: 0}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 12? Does it establish that background work kept up?"}],
  hints: ["Compare originals, acknowledged, ready and in-flight messages. Fast producer completions and low worker CPU do not prove sufficient consumer capacity.",
    "Visibility is 30 seconds, with no redeliveries in this window. A completed effect still owns prefetch credit until acknowledgement; the next job cannot be received when all credit is held.",
    "Change only worker Prefetch credit from 1 to 16. Keep parallel jobs, CPU work and acknowledgement delay fixed. As a wrong fix, restore the starter and extend only visibility to 60 seconds."],
  debrief: ["This slow consumer is constrained by receipt ownership, not CPU work or an expired lease. The reference receives later jobs while earlier acknowledgements wait, keeping the single processing slot and CPU cost per job. More in-flight messages can accompany less ready work and more acknowledgements.",
    "Longer visibility leaves the credit shortage in place. It supplies no extra consumer capacity when acknowledgements already fit inside the lease. More queue storage would only hold additional waiting work. Neither change increases the acknowledgement rate here.",
    "Saved counts support a credit hypothesis together with the captured settings and controlled comparison. They do not identify worker phases or measure message age. Inspect Ready messages and Oldest ready message age (seconds) in the saved queue measurements. Age describes the oldest ready message at second 12 and is Unknown when none is ready; neither that sample nor terminal counts reconstruct when work accumulated. Worker phases remain outside the saved report.",
    "Not proven: a process outage, exact backlog drain time, continuous health, a whole-run latency SLO, ordering, exactly-once effects or physical durability. The starter models a slow consumer throughout the observation window, not a crash and restart. Free-text diagnosis is not graded.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0],
    ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300, capacityMessages: 1000}}],
    ["worker", "Virtual Machine", 2, 0, {asyncWorker: {enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 20, acknowledgementDelayMs: 1500}}],
    ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
