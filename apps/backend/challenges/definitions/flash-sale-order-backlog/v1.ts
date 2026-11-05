import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const flashSaleOrderBacklogV1: ChallengeDefinition = {
  engine: "2", id: "flash-sale-order-backlog", version: 1, title: "Mission: absorb a flash sale", difficulty: "advanced",
  summary: "Keep the producer responsive and bring outstanding order-event work back down after a burst, without redelivery.",
  concepts: ["Producer versus consumer", "Burst backlog", "Worker CPU", "Acknowledgement leases"],
  story: ["A shop models each order event as an object upload followed by queue acceptance. Four requests/second become sixteen from second 120 until 140. A background worker writes a result object, then acknowledges the delivery.",
    "Educational assumptions: one worker core, 32 concurrent jobs and prefetch credits, 250 CPU ms/job and a 1500 ms delay after the result write before acknowledgement. The queue grants one-second visibility and retains messages for 300 seconds. Arrival traffic continues after the burst.",
    "Payments, stock guarantees and distributed transactions are conceptual only. Producer completion proves modeled upload and logical queue acceptance, not a successful order. This supported upload journey uses a direct app entry point; load balancer polling is not supported here."],
  objective: "At second 170, acknowledge at least 900 messages, leave at most 10 outstanding with no redeliveries, and record Healthy overall health and completed-request p95 at most 10 ms.",
  workload: {targetThroughput: 240, throughputUnit: "per-minute", trafficShape: "peak", peakMultiplier: 4, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Educational upload events: 4/s, 16/s at 120-140, then 4/s. Producer completion is queue acceptance, not worker or order completion.",
  evaluationSeconds: 170, evaluationNote: "Queue counts cover start through second 170, thirty seconds after the burst. p95 covers only completions in second 170, not the whole sale.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "queue-work", label: "Acknowledge 900; at most 10 outstanding and no redeliveries by second 170", resourceId: "queue", minAcknowledged: 900, maxOutstanding: 10, maxRedeliveries: 0},
    {id: "health", kind: "overall-health", label: "Overall modeled health is Healthy at second 170", allowed: ["healthy"]},
    {id: "latency", kind: "terminal-p95", label: "Producer completed-request p95 is at most 10 ms at second 170", maxMs: 10}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded thirty seconds after the burst at second 170?"}],
  hints: ["Watch ready and in-flight work during the burst. In the final report compare acknowledged originals with producer completions; repeated result effects are not acknowledgements.",
    "A longer lease cannot execute CPU work; faster processing still needs time for the saved acknowledgement delay. Compare each partial change. A larger queue adds waiting room.",
    "Try 100 CPU ms/job on worker and five seconds of visibility on queue. Keep concurrency, prefetch, acknowledgement delay, retention and max receives fixed."],
  debrief: ["Worker CPU and acknowledgement leases must work together. During the reference burst the queue holds excess work while the producer continues accepting events. After arrival rate drops, processing reduces outstanding work to the small ongoing in-flight population; it need not reach zero.",
    "Observe the live queue around second 140, then inspect its cumulative counters at 170. The saved terminal report alone does not establish the exact drain time or continuous producer health. Completed-request p95 at 170 does not cover the whole sale or failed requests.",
    "Not verified: payments, stock reservation, distributed transactions, order correctness, exactly-once effects, physical durability, production availability, dynamic worker scaling or a frontend load-balancer design. Authored CPU work represents an assumed optimization, not a code optimizer.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0],
    ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 1, maxReceives: 3, retentionSeconds: 300}}],
    ["worker", "Virtual Machine", 2, 0, {asyncWorker: {enabled: true, concurrency: 32, prefetch: 32, cpuMsPerJob: 250, acknowledgementDelayMs: 1500}}],
    ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
