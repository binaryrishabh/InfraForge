import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const chooseARetryMitigationV2: ChallengeDefinition = {
  engine: "2", id: "choose-a-retry-mitigation", version: 2, title: "Retries after a partition", difficulty: "advanced",
  summary: "Compare bounded retries with more retry pressure after a database-link outage. Keep the whole-run tradeoff visible.",
  concepts: ["Dependency outage", "Retry pressure", "Partial recovery"],
  story: ["At second 2 the app-to-database link is partitioned for two seconds. Four total attempts can leave queued app work after transport restores. The fixed script ends before second-6 evaluation.",
    "Reduce Maximum attempts to 2 as a mitigation, then test 5 separately as a near miss that fails the latency requirement. Keep the design and incident unchanged. Compare current latency, admissions, queued-at-VM counts and whole-run caller outcomes."],
  objective: "After the partition ends, complete requests with p95 at most 20 ms in second 6. Explain the tradeoff in whole-run completions and failures.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "200 reads/s, one app, unchanged DB. Completed-request latency in second 6 differs from whole-run outcomes.",
  evaluationSeconds: 6, evaluationNote: "Partition starts at 2,000,001 us and restores at 4,000,001 us. Exact application and end receipts are required.",
  scenario: {version: 1, visibility: "revealed", steps: [{id: "dependency-partition", atSecond: 2, request: {interventionId: "partition", revision: 1,
    target: {edgeId: "app-db", direction: "both"}, parameters: {duration: 2}}}]},
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 20 ms in second 6", maxMs: 20}],
  predictions: [{id: "busy", kind: "busiest-type", prompt: "Which resource type has the highest known CPU at second 6 after the dependency link restores?"},
    {id: "health", kind: "overall-health", prompt: "What modeled health will be recorded at second 6?"}],
  hints: ["Compare the two reports at the same second. Then inspect cumulative accepted backend admissions and queued-at-VM counters; these populations overlap.",
    "A larger retry count cannot restore the partitioned link. It can keep more attempts competing with fresh traffic after the scripted restoration.",
    "Select lb. Change only Retry policy Maximum attempts from 4 to 2. Test 5 separately as a near miss, then compare whole-run failures as well as p95."],
  debrief: ["Transport restoration and later pressure are different facts. The controlled runs change only total retry attempts under the same scripted partition. Reduced retries shorten this completion tail; they can also abandon callers that more retries eventually finish.",
    "Second-6 p95 covers only requests completed in that second. Whole-run successes, failures and unfinished callers describe a different population. Lower current latency does not establish greater availability or a whole-run SLO.",
    "A retained Healthy sample after a verified end is a sample, not continuous recovery or recovery time. This scenario partitions a dependency link; it does not crash the database, VM or load-balancer process. Packet-level behavior and production availability are unsupported.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60}, retry: {enabled: true,
    maxAttempts: 4, backoffMs: 1, jitterRatio: 0.2, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"]}}],
    ["app", "Virtual Machine", 1, 0], ["db", "Database", 2, 0]], [["lb", "app"], ["app", "db"]]),
};
