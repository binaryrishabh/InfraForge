import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const oneVmOrAPoolV1: ChallengeDefinition = {
  engine: "2", id: "one-vm-or-a-pool", version: 1, title: "One VM or a pool", difficulty: "core",
  summary: "Split a large VM into a pool and measure caller outcomes when one VM crashes.",
  concepts: ["Horizontal capacity", "Survivor headroom", "Retry routing", "Cumulative caller outcomes"],
  story: ["A load balancer sends 500 reads/second to one c5.xlarge app and a medium database. Just after second 2, app crashes: owned work aborts, new work is refused and the modeled one-second restart finishes just after second 4. The outage includes the restart; this is a VM process failure, not a link partition.",
    "Through second 5, complete at least 2000 callers with at most 30 unsuccessful callers; completed-request p95 in second 5 must be at most 20 ms. Keep the educational monthly estimate at most $200. Compare splitting the app tier into two c5.large VMs with three small VMs, under the same script and retry policy."],
  objective: "Keep app as the crash target. Choose a pool with enough surviving capacity and explain its measured cost and latency concessions.",
  workload: {targetThroughput: 30000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "500 reads/s; fixed least-outstanding selection, two total attempts, unchanged database. Generic small and catalog CPU capacities are educational assumptions.",
  evaluationSeconds: 5, evaluationNote: "Score cumulative caller outcomes through second 5 and completions in second 5 separately. A fast final sample cannot erase callers failed during the crash.",
  scenario: {version: 1, visibility: "revealed", steps: [{id: "lose-app", atSecond: 2, request: {interventionId: "vm-crash", revision: 1, target: {resourceId: "app"}, parameters: {duration: 2}}}]},
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "caller-outcomes", label: "Complete 2000 callers with at most 30 unsuccessful through second 5", minCompleted: 2000, maxUnsuccessful: 30},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 20 ms in second 5", maxMs: 20},
    {id: "budget", kind: "monthly-budget", label: "Educational monthly estimate is at most $200", maxUsd: 200}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 5, separately from cumulative caller success?"}],
  hints: ["Run unchanged. Compare final p95 with whole-run failed callers; the final sample is after the restart.",
    "Replace the app tier with two c5.large VMs, both behind lb and connected to db. Keep app as the target and leave selection, retries, checks and database unchanged.",
    "Try three small VMs as another design. Two small VMs leave only one small survivor during the crash; compare that near miss too. Do not require Healthy health when the stated requirements concern callers and latency."],
  debrief: ["The single large VM can record low final latency after restarting while failing many earlier callers. The caller-outcomes requirement counts failures, deadline expiry and abandonment separately from unfinished work; no in-flight request is counted as successful.",
    "The two catalog VMs and the three small VMs can both pass. Compare their educational estimates, final resource CPU and latency. Lower cost can coexist with a saturated resource sample. Neither design is universally best, and neither proves continuous health.",
    "The script reuses the engine's VM crash, owned-work cancellation and readiness hooks with a fixed one-second restart. It does not model host repair, data loss, DB or load-balancer failure, physical availability or cloud failover time.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbSelection: {version: 1, policy: "least-outstanding"}, lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60},
    retry: {enabled: true, maxAttempts: 2, backoffMs: 1, jitterRatio: 0.2, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"]}}],
    ["app", "Virtual Machine", 1, 0, {skuId: "c5.xlarge"}], ["db", "Database", 2, 0, {size: "medium"}]], [["lb", "app"], ["app", "db"]]),
};
