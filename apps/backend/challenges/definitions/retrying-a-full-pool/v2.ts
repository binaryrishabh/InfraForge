import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const retryingAFullPoolV2: ChallengeDefinition = {
  engine: "2", id: "retrying-a-full-pool", version: 2, title: "Retries cannot create capacity", difficulty: "advanced",
  summary: "Limit repeated backend admissions into a saturated VM pool, then check whether useful throughput changes.",
  concepts: ["Retry amplification", "Backend admissions", "Offered and completed traffic"],
  story: ["The app's CPU quota is 25%, with four worker slots and two queue places. New traffic keeps arriving faster than it can finish. The load balancer retries refusals up to five attempts.",
    "A deeper queue can meet the retry budget without reducing attempts; that is a separate capacity experiment. Count accepted backend admissions plus VM refusals across the run. Compare that with all offered caller requests, including failures and unfinished work. Queued-at-VM counts overlap admissions and must not be added again."],
  objective: "Through second 6, keep backend admission attempts at or below two per offered caller request. Passing this load budget does not mean the service has enough capacity.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "200 reads/second, light payloads, one VM behind lb. Quota and admission limits remain fixed; no database slowdown or fault.",
  evaluationSeconds: 6, evaluationNote: "Cumulative admissions and offered requests through second 6. Completed/failed requests per second describe a different window.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "amplification", kind: "backend-admission-budget", label: "At most two backend admission attempts per offered caller through second 6", maxPerOfferedRequest: 2}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will remain at second 6, even if the retry load budget is met?"}],
  hints: ["In LB accounting, add Accepted by backend and Rejected by VM. Queued at VM is an overlapping counter, not extra traffic.",
    "Four total attempts still repeat work against a full pool. A deeper queue can also meet this admission budget by absorbing retries; it does not create CPU capacity. Keep the queue fixed for this retry experiment.",
    "Select lb and change Retry policy Maximum attempts from 5 to 2. Keep backoff, jitter, concurrency and app settings unchanged."],
  debrief: ["The budget compares cumulative backend admission attempts with cumulative offered caller requests. Offered callers are completed + failed + deadline-exceeded + abandoned + in-flight in whole-run evidence.",
    "Retries can increase refused admissions without increasing completed throughput. The load budget deliberately allows the pool to remain saturated; restoring capacity is a separate experiment.",
    "These are bounded retries, never truly unbounded. Admissions count attempts that reach the VM gate, not every network attempt or unique caller. The counters do not prove billed cost, availability or a latency SLO. Backoff can be explored separately, with another controlled comparison.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbSelection: {version: 1, policy: "round-robin"},
    lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60}, retry: {enabled: true, maxAttempts: 5, backoffMs: 1,
      jitterRatio: 0.2, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"]}}],
  ["app", "Virtual Machine", 1, 0, {size: "small", vmCpuQuota: {version: 1, limitPercent: 25},
    vmExecution: {version: 1, workers: 4, queuedRequests: 2}}]], [["lb", "app"]]),
};
