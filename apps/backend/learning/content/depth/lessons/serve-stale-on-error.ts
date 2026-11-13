import type { LearningLesson } from "@infraforge/contracts/learning";

export const serveStaleOnError: LearningLesson = {
  id: "serve-stale-on-error", contentVersion: 1, trackId: "depth", moduleId: "bounded-staleness",
  title: "Serve stale on error", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Keep normal answers fresh, but let an expired entry answer for a bounded time while the database is down.",
  prerequisites: ["concurrent-cache-misses", "percentiles-and-populations"],
  problem: ["The database is down and every cache refill fails, so callers fail even though the cache once held the answer. Run the starter and trace why."],
  explanation: ["Predict overall health with the database still down. Then read the cache's hits, misses and expirations beside whole-run failed callers.",
    "Select cache and set Serve stale after expiry (seconds) to a bound you accept. Keep the TTL unchanged. Compare the two saved reports and confirm one change.",
    "Read the stale answers served and the oldest stale answer past expiry. That reading is measured from the moment the entry expired, so the body actually served is at most the TTL plus the bound old. Each stale answer is counted separately from fresh hits; it is never reported as fresh.",
    "Restore the starter and try a bigger database, more balancer retries or a longer TTL as near misses, then a stale bound that is too short. The first two cannot answer while the database is down; a longer TTL gives up normal freshness; a short bound runs out before the outage ends."],
  experiment: {challengeId: "serve-stale-on-error", prediction: "Will overall health look Healthy while the database is still down?",
    evidenceToInspect: ["Cache: Hits", "Cache: Misses", "Cache: Expirations", "Cache: Stale answers served", "Cache: Oldest stale answer past expiry (us)", "Whole run: Failed"]},
  limitations: ["Results are educational model outputs with an authored outage, bound and workload, not provider benchmarks.",
    "A stale answer is only acceptable for data where an old value is safe. This lab shows availability and age, not correctness. Writes invalidate an entry, so a stale answer is only served for an entry that was not invalidated.",
    "The model treats a database reply that succeeds but lacks the requested key (for example a deleted row) as a failed fill, so a retained expired body can still be served for it. A real system may need to tell not-found from unavailable. Each waiting caller that receives a stale answer is counted separately.",
    "A reading missing from the report stays Unknown; no stale count is assumed when no bound is saved."],
  followUp: "Cite the starter, the stale bound and the near misses. Explain what freshness was given up, for how long, and where an old answer would be unsafe.",
  check: null,
};
