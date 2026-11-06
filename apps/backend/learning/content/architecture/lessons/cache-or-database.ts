import type { LearningLesson } from "@infraforge/contracts/learning";

export const cacheOrDatabase: LearningLesson = {
  id: "cache-or-database", contentVersion: 1, trackId: "architecture", moduleId: "cross-resource-choices",
  title: "Cache or database", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Defend caching or database capacity under the same read workload, latency requirement and educational budget.",
  prerequisites: ["cache-hits-and-misses", "database-read-and-write", "where-does-the-time-go"],
  problem: ["Requirements: 1200 reads/second, completed-request p95 at most 20 ms in second 6, at least 7000 completed callers without unsuccessful callers through second 6, and an educational monthly estimate at most $200. The app calls a small database directly. The database uses sixteen logical keys with the fixed hot-key pattern.",
    "Choose either a cache between app and db or a database capacity increase. Keep the app, keyspace, traffic and seed fixed. Explain which requirement the starter misses before choosing a design."],
  explanation: ["Run the direct starter. Compare app and database CPU with p95 and whole-run caller failures; use the overloaded resource to explain the starting tail.",
    "Insert a cache holding sixteen logical entries and remove the direct app-db edge. Run again with the original database. Then compare a direct design using the database catalog option in the challenge hint. Both are valid candidates under the same requirements.",
    "Compare each report's educational estimate, database CPU, completed callers and p95. Defend the extra dependency and cost of caching against its reuse of this fixed read working set. Try enlarging only the app as a near miss."],
  experiment: {challengeId: "cache-or-database", prediction: "Which resource type will be busiest, and which design choice will meet the requirement?",
    evidenceToInspect: ["CPU; p95", "Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Monthly estimate (CostEstimate gate)"]},
  limitations: ["Results are educational model outputs. Monthly estimates and catalog properties are educational assumptions, not provider prices or performance measurements.",
    "The fixed hot-key pattern and read-only workload do not represent arbitrary popularity, writes, invalidations or mutable-data correctness. The saved report does not retain cache hits or misses; low database CPU alone cannot establish a hit ratio.",
    "The p95 requirement concerns completions in the evaluation second. Neither design establishes a whole-run latency SLO, continuous health or availability under cache or database failure."],
  followUp: "Cite both passing reports and recommend either design under the stated budget. Explain what it gives up, then name a workload or fault that these runs leave Unknown.", check: null,
};
