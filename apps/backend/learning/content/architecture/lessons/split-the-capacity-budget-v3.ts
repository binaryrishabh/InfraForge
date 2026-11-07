import type { LearningLesson } from "@infraforge/contracts/learning";

export const splitTheCapacityBudgetV3: LearningLesson = {
  id: "split-the-capacity-budget", contentVersion: 3, trackId: "architecture", moduleId: "capacity-budgets",
  title: "Split the capacity budget", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Meet latency, sampled health and a catalog budget together, then defend where to buy extra capacity or leave money unspent.",
  prerequisites: ["response-time-and-throughput", "writes-cost-more-than-reads", "cache-or-database", "one-vm-or-a-pool"],
  problem: ["A direct app-to-database service offers 660 requests/second, half reads and half writes. Both tiers start on the cheapest DigitalOcean catalog sizes. Keep the traffic, direct path and execution policies fixed. Allocate capacity across the tiers using Instance size in the inspector.",
    "Requirements: p95 at most 20 ms and Healthy overall health in second 6; at least 3800 completed callers without unsuccessful callers through second 6; catalog sizes on every app and database; monthly estimate at most $180. Compare a sufficient pair with different allocations of extra headroom."],
  explanation: ["Predict the busiest resource, then run the starter. Compare CPU, overall health, p95 and whole-run caller outcomes. Change only app's Instance size as the hint describes. Run again: low latency can coexist with a saturated database and a failed health requirement.",
    "Change only the database Instance size next. Compare the resulting report with the app-only report under the same seed and workload. Then enlarge only app or only database in separate attempts; record where sampled CPU falls and whether p95 or useful completions improve.",
    "Try both larger choices together. Read Monthly estimate (CostEstimate gate) and the budget requirement's amount, limit and evidence source. A report can pass every performance requirement while failing only budget. Remove a capacity purchase and check which constraint fails first.",
    "Defend a passing allocation, including the option of leaving budget unspent. In Recorded cost estimates, inspect Monthly resource price line items and Remaining monthly budget alongside the total and sampled CPU. Remaining budget is the limit minus the recorded gate total; a negative amount means the design is over budget."],
  experiment: {challengeId: "split-the-capacity-budget", prediction: "Which resource type will be busiest, and what overall health will this allocation record?",
    evidenceToInspect: ["CPU; Overall health; p95", "Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Monthly estimate (CostEstimate gate); Monthly resource price line items; Remaining monthly budget"]},
  limitations: ["Results are educational model outputs. Prices are catalog snapshot figures, not a quote. The model's capacity numbers, scheduling and timings are educational assumptions, not measured provider performance.",
    "The saved report uses prices retained by the run, not the current catalog. Missing or invalid line items remain Unknown; remaining budget needs a usable recorded total and the exact reviewed budget requirement. These figures do not establish billing accuracy, regional or network charges, runtime scaling cost, or a cheapest possible cloud design.",
    "p95 covers completions in the evaluation second; health is sampled there. Neither proves a whole-run latency SLO, continuous health, recovery or availability. Lower sampled CPU does not establish a maximum supported arrival rate.",
    "The direct path applies no outage, retry, replica or cache. No multi-provider placement, consistency, durability or application correctness is tested; changing a catalog tier changes several properties together."],
  followUp: "Cite passing reports and both near misses. Explain where extra spending changes CPU without improving measured caller outcomes, recommend an allocation under the stated budget, and name a workload or fault that your evidence leaves Unknown.",
  check: null,
};
