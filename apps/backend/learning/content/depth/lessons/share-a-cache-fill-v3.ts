import type { LearningLesson } from "@infraforge/contracts/learning";

export const shareACacheFillV3: LearningLesson = {
  id: "share-a-cache-fill", contentVersion: 3, trackId: "depth", moduleId: "failure-controls",
  title: "Join overlapping cache misses", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Enable Single-flight alone and compare the response-time tail after a database CPU slowdown.",
  prerequisites: ["concurrent-cache-misses", "percentiles-and-populations"], check: null,
  problem: ["The cache fits the only logical key, but overlapping misses can each fetch it while the database is slow."],
  explanation: ["Run the starter. The scenario lowers db CPU at second 2 and restores it just after second 4. Inspect the saved action receipts, completed-request p95 in second 5 and whole-run caller counts through second 5.",
    "Select cache. Under Cache behavior, enable only Single-flight, then run again. Keep the one-second TTL, logical capacity, topology and workload unchanged. Compare p95 and caller outcomes in both reports.",
    "As a near miss, restore the starter and increase only logical cache capacity. There was already room for the only key. Inspect saved Application helper: Coalesced waiters alongside Application helper: Database fetches. Name the helper owner and compare the same run window."],
  experiment: {challengeId: "share-a-cache-fill", prediction: "Can the starter database be Healthy at second 5 while its completed-request latency requirement still fails?",
    evidenceToInspect: ["p95; CPU", "Whole run: Completed; Whole run: Failed; Whole run: In-flight; Deadline exceeded; Abandoned", "Applies at; baseline restore at", "Cache: Hits; Cache: Misses; Cache: Expirations; Cache: Evictions", "Application helper: Database fetches; Application helper: Coalesced waiters"]},
  limitations: ["Results are educational model outputs. The p95 requirement covers only second-5 completions; caller counts cover the run through that second. Neither a Healthy sample nor this p95 measures continuous recovery or a whole-run latency SLO.",
    "Single-flight coordinates pending fetches within an aside owner. This lab uses one app and one read-only key; no cross-replica lock, mutable-data freshness or exactly-once guarantee is tested.",
    "Cache command counters and each application helper's fetch and waiter counts accumulate from run start through the snapshot. Waiters are helper requests joining a pending fetch, not cache hits or original callers. The cache targeting-helper total repeats those waiters and must not be added to them. Missing or null counters stay Unknown, including in old reports. CPU capacity and timings are authored assumptions."],
  followUp: "Use both saved reports to explain why the tail changed without changing completed caller totals, and why extra room could not combine unfinished fetches.",
};
