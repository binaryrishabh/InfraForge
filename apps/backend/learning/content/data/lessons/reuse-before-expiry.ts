import type { LearningLesson } from "@infraforge/contracts/learning";

export const reuseBeforeExpiry: LearningLesson = {
  id: "reuse-before-expiry", contentVersion: 1, trackId: "data", moduleId: "cache-lifetime",
  title: "Room to fit, time to reuse", kind: "executable-lab", level: "beginner", availability: "available",
  summary: "Separate cache expiry from eviction while keeping the read workload and capacity fixed.",
  prerequisites: ["cache-hits-and-misses", "response-time-and-throughput"],
  problem: ["A read-only service offers 1000 reads/second across 256 uniformly selected logical keys. The cache has room for every key, but each filled value expires after 1 second."],
  explanation: ["Predict database health, then run unchanged. Read second-6 p95 alongside database CPU and whole-run caller outcomes. A Healthy label can coexist with a failed latency requirement.",
    "Select cache. Under Cache behavior, increase Cache TTL to keep values reusable through the scored window, using the challenge hint. Keep Logical cache capacity, Single-flight, topology and workload unchanged, then compare the reports.",
    "As a near miss, restore the starter TTL and increase only logical capacity. Inspect live expirations and evictions separately. Explain why more space cannot extend a filled value's lifetime."],
  experiment: {challengeId: "reuse-before-expiry", prediction: "Will the starter database record Healthy even when completed-request latency misses the requirement?",
    evidenceToInspect: ["p95; CPU; Health", "Completed requests/s; Failed requests/s", "Whole run: Completed; Whole run: Failed; Whole run: In-flight"]},
  limitations: ["Results are educational model outputs. The p95 requirement covers completions in second 6, while the caller requirement covers the whole run through that second. Neither proves a whole-run latency SLO or production availability.",
    "Cache hit, miss, expiration and eviction counters are live-only here; the saved report retains latency and database CPU, not a hit ratio. Missing evidence stays Unknown.",
    "The cache starts empty. TTL starts at a successful fill and is not refreshed by a hit. This fixed read-only keyspace has no writes, invalidations or freshness requirement; longer TTL does not prove consistency for mutable data."],
  check: null,
  followUp: "Use both reports to explain the extra source work after expiry. Which live counters distinguish expiry from eviction, and what would a mutable-data service still need to verify?",
};
