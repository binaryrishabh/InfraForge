import type { LearningLesson } from "@infraforge/contracts/learning";

export const budgetForAPartition: LearningLesson = {
  id: "budget-for-a-partition", contentVersion: 1, trackId: "advanced", moduleId: "investigation-and-tradeoffs",
  title: "Budget for a partition", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Defend two valid capacity choices using real fault evidence, educational cost and measured spare CPU.",
  prerequisites: ["mitigation-tradeoffs", "one-bigger-or-two-smaller", "route-around-a-slow-vm"],
  problem: ["Requirements: 500 reads/s, second-5 completed-request p95 at most 20 ms, Healthy second-5 health and at most $200/month in the educational estimate. The script partitions lb-app from just after second 2 to just after second 4.",
    "Assumptions: two initial one-core apps; 3 ms app CPU and 1 ms DB CPU per read; a two-core database; least-outstanding selection; two total attempts. Consider a two-core c5.large peer and a four-core c5.xlarge peer under the same workload and fault."],
  explanation: ["Run unchanged, then change only peer's instance to c5.large and run again. Verify the exact partition target and end receipt before reading the requirements. Keep the app, DB, retry and selection settings fixed.",
    "Try c5.xlarge on peer as a second valid design. Compare educational monthly estimate, peer CPU at second 5, final p95 and cumulative caller outcomes. State the smaller design's headroom concession and the larger design's cost concession.",
    "Defend either passing design under the requirements. Explain the precise tested failure scope and the shared dependencies that remain. Enlarging only app is a near miss because the survivor remains small during its link outage. Requirements are engineering constraints; there are no interview scores or hiring judgments."],
  experiment: {challengeId: "budget-for-a-partition", prediction: "Will this design meet the sampled-health requirement after the fixed link partition, and what does it give up?",
    evidenceToInspect: ["Resolved targets:; Applies at; baseline restore at", "CPU; Overall health; p95", "Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Monthly estimate (CostEstimate gate)"]},
  limitations: ["Spare CPU is inferred only from the retained second-5 utilization sample. It is not a measurement of maximum request capacity or health throughout the outage.",
    "The fault partitions one app link. It does not fail a VM process, DB, load balancer or every dependency. Neither design establishes availability, failover time or tolerance of another fault combination.",
    "Results are educational model outputs. Catalog core counts, work durations and monthly estimates are educational assumptions. Provider performance, actual bills and hiring suitability are not verified."],
  followUp: "Give a short architecture recommendation citing both passing reports. State the cost/headroom concession, the exact tested failure tolerance and at least two untested failures. Either design can be a valid answer under the fixed requirements.", check: null,
};
