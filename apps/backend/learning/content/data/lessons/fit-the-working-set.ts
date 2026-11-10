import type { LearningLesson } from "@infraforge/contracts/learning";

export const fitTheWorkingSet: LearningLesson = {
  id: "fit-the-working-set", contentVersion: 1, trackId: "data", moduleId: "cache-working-set",
  title: "Fit the working set", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Tell eviction from expiry: a cache too small for its keys keeps missing no matter how long entries live.",
  prerequisites: ["cache-hits-and-misses", "reuse-before-expiry"],
  problem: ["The service reads 256 keys evenly, but the cache holds only 16 entries and keeps each for 30 seconds. Most reads still reach the database."],
  explanation: [
    "Predict the database health, run unchanged and compare database CPU with the cache's hits, misses, expirations and evictions in the saved report. Evictions with few expirations mean entries leave because there is no room, not because they aged out.",
    "Record a diagnosis: the cache cannot hold the working set. Select cache, open Cache behavior and change only Logical cache capacity from 16 to 256. Keep TTL, single-flight, topology and workload fixed. The design review must count one change.",
    "Run again. Reads are now reused until their lifetime ends, so database CPU and the final-second p95 fall and the database requirement is met.",
    "As a near miss, restore the starter and raise only the TTL. Nothing was expiring early, so the result does not move. Compare it with reuse-before-expiry, where the keys already fit and expiry was the limit."],
  experiment: {challengeId: "fit-the-working-set", prediction: "What database health will the starter record at second 6? Only the health choice is scored; explain whether caching that misses helps.",
    evidenceToInspect: ["CPU; p95", "Cache: Hits; Cache: Misses; Cache: Expirations; Cache: Evictions", "Whole run: Completed; Whole run: Failed; Whole run: In-flight"]},
  limitations: [
    "Results are educational model outputs, not cloud benchmarks. The key count, capacity, timing and CPU demands are authored assumptions.",
    "Cache counters count cache commands, not a caller hit ratio. The workload has no writes, invalidation or freshness requirement, and uniform key choice is the only pattern used here.",
    "A final-second p95 and fixed-second sample prove no whole-run latency target, consistency or availability guarantee."],
  check: null,
  followUp: "Cite the starter, improved and TTL near miss reports. Explain how evictions and expirations differ, and when a larger cache stops helping. Then compare reuse-before-expiry (the keys fit and expiry is the limit) and catalogue-link-flash (a few hot keys).",
};
