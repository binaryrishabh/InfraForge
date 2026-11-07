import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const splitTheCapacityBudgetV1: ChallengeDefinition = {
  engine: "2", id: "split-the-capacity-budget", version: 1, title: "Split the capacity budget", difficulty: "advanced",
  summary: "Allocate a fixed catalog budget across app and database capacity; compare where extra headroom is useful.",
  concepts: ["Coupled bottlenecks", "Capacity allocation", "Catalog budget", "Marginal headroom"],
  story: ["A service offers 660 requests/s, half reads and half writes, on a direct app-to-database path. Both start on the cheapest DigitalOcean catalog sizes. Keep the workload, direct path and default execution policies fixed; change Instance size on app and db.",
    "Requirements: Healthy overall health and completed-request p95 at most 20 ms in second 6; at least 3800 completed callers without unsuccessful callers through second 6; every app and database sized from the catalog; monthly estimate at most $180.",
    "Consider three allocations: a sufficient smaller pair, more app headroom, or more database headroom. Buying the larger choice on both tiers exceeds this budget. Prices are catalog snapshot figures, not a quote; capacity numbers are educational assumptions."],
  objective: "Meet performance and budget requirements together. Compare different passing allocations and defend whether spending the remaining budget buys useful sampled headroom.",
  workload: {targetThroughput: 39600, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.5, payloadSize: "light"},
  workloadNote: "660 requests/s, half reads and half writes. Default educational app and database CPU work; no faults, retries, caches or replicas.",
  evaluationSeconds: 6, evaluationNote: "p95 and health are second-6 samples; caller populations cover start through second 6. No whole-run latency SLO or continuous health claim.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "sizes", kind: "catalog-sizes", label: "Every app server and database uses a catalog instance size"},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 20 ms in second 6", maxMs: 20},
    {id: "health", kind: "overall-health", label: "Overall health is Healthy in second 6", allowed: ["healthy"]},
    {id: "work", kind: "caller-outcomes", label: "Complete 3800 callers without unsuccessful callers through second 6", minCompleted: 3800, maxUnsuccessful: 0},
    {id: "budget", kind: "monthly-budget", label: "Catalog snapshot monthly estimate is at most $180", maxUsd: 180}],
  predictions: [{id: "busy", kind: "busiest-type", prompt: "Which resource type will record the highest CPU in second 6 for your current allocation?"},
    {id: "health", kind: "overall-health", prompt: "What overall health will this allocation record in second 6?"}],
  hints: ["Run the cheapest pair first. Then select app: Instance size > Provider > DigitalOcean > Basic 4 vCPU / 8 GB. The unchanged database can become the busy tier; a low p95 alone does not meet the health requirement.",
    "Select db: Instance size > Provider > DigitalOcean > Managed PG 2 vCPU / 4 GB. Compare the resulting pair with Basic 8 vCPU / 16 GB on app, or Managed PG 4 vCPU / 8 GB on db. Keep the other tier unchanged each time.",
    "Run both larger choices together as a near miss. Inspect Monthly estimate (CostEstimate gate) and the budget requirement: can every performance requirement pass while only budget fails? Compare app and database CPU before spending more."],
  debrief: ["The cheapest app exhausts its CPU and accumulates or refuses work. Enlarging only that app exposes a second constraint: the one-core database uses nearly all of its CPU on the mixed read/write workload. Enlarging only the database leaves the original app bottleneck.",
    "The smaller passing pair and the two headroom allocations satisfy the same requirements. Extra app capacity lowers sampled app CPU; extra database capacity lowers sampled database CPU. Neither extra purchase improves the calibrated terminal p95 or caller completions here. Keeping money unspent is also a defensible choice.",
    "Buying both larger choices records Healthy health and low p95 but fails only budget. Compare the saved monthly total and its requirement detail. Resource line items are not rendered in the saved report; audit the chosen SKU prices in the designer, not an invented report breakdown.",
    "Prices are catalog snapshot figures, not a quote. CPU capacity, scheduling, sessions and timings are educational assumptions, not cloud benchmarks. This fixed direct path tests no failure, replication, network placement or availability. A catalog change can change several properties together.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {skuId: "s-1vcpu-512mb-10gb"}],
    ["db", "Database", 2, 0, {skuId: "db-s-1vcpu-1gb"}]], [["app", "db"]]),
};
