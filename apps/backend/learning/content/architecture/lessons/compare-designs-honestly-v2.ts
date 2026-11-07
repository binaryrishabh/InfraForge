import type { LearningLesson } from "@infraforge/contracts/learning";

export const compareDesignsHonestlyV2: LearningLesson = {
  id: "compare-designs-honestly", contentVersion: 2, trackId: "architecture", moduleId: "design-reasoning",
  title: "Compare designs honestly", kind: "reading", level: "intermediate", availability: "available",
  summary: "Turn a failed requirement into a controlled design choice, then explain its concessions.",
  prerequisites: ["first-bottleneck", "where-does-the-time-go", "response-time-and-throughput"], experiment: null,
  problem: ["A design feels slow. Before adding a cache, a bigger database or another server, write what the design must achieve and which observation could disprove your proposed fix."],
  explanation: [
    "Keep workload, window, seed and requirements fixed. In Cache or database (cache-or-database), compare app and database CPU, p95 and Whole run: Failed. A bigger app is a competing hypothesis. Inspect saved Cache: Hits and Cache: Misses for cache commands, and Application helper: Database fetches for source work. Low database CPU alone cannot supply a hit ratio. Counters accumulate through the snapshot, separately from original callers and final-second rates. Missing evidence stays Unknown, including old reports.",
    "In Limit or capacity (limit-or-capacity), inspect Route throttles (429), Upstream failures (502) and Whole run: Completed alongside read-app CPU. Ask whether the requirement permits refusing work. Admission control and more workers address different goals: protecting a backend does not mean serving every caller. Gateway price is Unknown, so do not invent a priced ranking.",
    "In One VM or a pool (one-vm-or-a-pool), compare p95 with Whole run: Completed, Whole run: Failed and Whole run: In-flight under the recorded crash script. Read the target and action timing before crediting the pool. A final response-time sample cannot erase calls lost earlier, and a pool tested against one VM crash has not been tested against every shared dependency failure.",
    "In Split the capacity budget (split-the-capacity-budget), compare both tiers' CPU, Overall health, p95 and Monthly estimate (CostEstimate gate) after each Instance size change. Test the smallest relevant change, then recheck every requirement. Smallest means a focused test, not a global cost optimum. Record: requirement, suspected bound, changed control, measurement and concession. Refused callers, an extra dependency or spending may matter. State what stays Unknown; choose between passing designs using explicit priorities."
  ],
  check: {question: "A pool has a fast final p95 after a crash, but misses the requirement for cumulative successful callers. Is it an acceptable design for those requirements?",
    choices: [{id: "window", text: "No. The cumulative caller requirement still fails; inspect those outcomes before another controlled change."},
      {id: "fast", text: "Yes. The final p95 replaces earlier caller outcomes."},
      {id: "cheap", text: "Yes, provided its monthly estimate is lower."}],
    correctChoiceId: "window", explanation: "Requirements describe separate populations and windows. Neither final latency nor lower cost cancels a cumulative caller failure. A useful next change must target the remaining failed requirement."},
  limitations: ["This is a comparison method, with no executable experiment or simulated result of its own. Use the linked labs' actual reports; separate labs are not controlled comparisons with each other.",
    "The labs use educational capacities, workloads and timing. Terminal p95 covers completed callers in its evaluation second; health is sampled. Neither establishes a whole-run SLO, continuous health or production availability.",
    "Catalog estimates are not cloud bills. These experiments do not establish application correctness, mutable-data cache safety, durability or behavior under untested workloads and faults. Missing measurements stay Unknown."],
  followUp: "Open Cache or database (cache-or-database). Write the comparison record before changing the starter, then use the same method for limit-or-capacity, one-vm-or-a-pool and split-the-capacity-budget.",
};
