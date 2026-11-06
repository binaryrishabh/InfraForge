import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const budgetForAPartitionV1: ChallengeDefinition = {
  engine: "2", id: "budget-for-a-partition", version: 1, title: "Budget for a partition", difficulty: "advanced",
  summary: "Defend a capacity choice under fixed traffic and a scripted link outage. Compare cost and measured spare CPU without a grade.",
  concepts: ["Architecture tradeoffs", "Survivor capacity", "Educational cost", "Fault scope"],
  story: ["Requirements: 500 reads/s, second-5 p95 at most 20 ms, Healthy second-5 health and an educational monthly estimate at most $200. From second 2 for two seconds the lb-app link is partitioned. Keep that path and target in the design.",
    "Both apps start with one educational core; each read uses 3 ms of app CPU and 1 ms of DB CPU. The medium DB has two cores. Compare a c5.large peer (two cores) with a c5.xlarge peer (four). Both can satisfy the requirements; defend what each gives up."],
  objective: "Meet the fixed latency, sampled-health and educational budget constraints under the scripted partition. Compare two valid peer sizes; explain a choice without grades or hiring judgments.",
  workload: {targetThroughput: 30000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "500 reads/s, 3 ms app CPU and 1 ms DB CPU per read; steady from start. Least-outstanding selection and two total retry attempts stay fixed.",
  evaluationSeconds: 5, evaluationNote: "Partition starts at 2,000,001 us and ends at 4,000,001 us. Second-5 measurements do not establish health throughout the outage.",
  scenario: {version: 1, visibility: "revealed", steps: [{id: "isolate-app", atSecond: 2, request: {interventionId: "partition", revision: 1,
    target: {edgeId: "lb-app", direction: "both"}, parameters: {duration: 2}}}]},
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 20 ms in second 5", maxMs: 20},
    {id: "health", kind: "overall-health", label: "Overall health is Healthy in second 5", allowed: ["healthy"]},
    {id: "budget", kind: "monthly-budget", label: "Educational monthly estimate is at most $200", maxUsd: 200}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will this design record at second 5 under the fixed partition scenario?"}],
  hints: ["Run the starter. Compare the survivor's CPU with the final completion tail and whole-run failures. A no-fault result does not establish fault headroom.",
    "Change only peer to c5.large. Keep app, the DB, selection and retry policy unchanged. Enlarging app alone leaves the isolated path and small survivor during the fault.",
    "Try c5.xlarge on peer as another valid design. Compare its educational estimate and sampled CPU with c5.large; state why neither run covers a shared DB outage or another fault."],
  debrief: ["The smaller passing peer gives up spare sampled CPU in exchange for a lower educational estimate. The larger peer buys more sampled CPU headroom under the identical script. These are two valid designs, not interview scores; explain a recommendation under the stated requirements.",
    "The controlled starter/reference comparison changes only peer's instance selection. The fault interrupts one app link, not a VM process or every dependency. At evaluation the link has restored; a passing final sample does not prove uninterrupted health during the partition.",
    "Both designs still share the database and load balancer. Unmeasured fault combinations, failover time, availability, larger traffic and provider pricing remain Unknown. A lower CPU sample does not establish a maximum supported request rate.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbSelection: {version: 1, policy: "least-outstanding"}, lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60},
    retry: {enabled: true, maxAttempts: 2, backoffMs: 1, jitterRatio: 0.2, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"]}}],
  ["app", "Virtual Machine", 1, 0, {size: "small"}], ["peer", "Virtual Machine", 1, 1, {size: "small"}], ["db", "Database", 2, 0, {size: "medium"}]],
  [["lb", "app"], ["lb", "peer"], ["app", "db"], ["peer", "db"]]),
};
