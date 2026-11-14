import type { LearningLesson } from "@infraforge/contracts/learning";

export const traceASlowdownCascade: LearningLesson = {
  id: "trace-a-slowdown-cascade", contentVersion: 1, trackId: "diagnosis", moduleId: "capstone-cascades",
  title: "Trace a slowdown cascade", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Trace lost callers from balancer timeouts through evicted cache entries to database reads. Single-flight is already on.",
  prerequisites: ["concurrent-cache-misses", "fit-the-working-set"],
  problem: ["A cache already shares overlapping fills, yet a three-second database slowdown still loses callers. Its sixteen-key service ends at second 10 Healthy. Diagnose the earlier loss before choosing a change."],
  explanation: ["Read the saved balancer counters first: downstream timeouts, retry attempts and admission refusals distinguish symptoms. Next compare cache evictions with expirations and the app helper's source fetches with coalesced waiters. Single-flight is active; different keys still need different database reads.",
    "During the slowdown compare database serving queries with the scenario's reduced CPU budget. Those serving queries compete for the small budget; the terminal report does not retain that earlier serving sample. Explain the chain: eviction keeps source reads necessary, the CPU cut makes reads compete, and callers time out upstream. Do not infer a full database query queue from timeouts: the queued count can stay zero while serving queries contend.",
    "Change only Logical cache capacity to hold the sixteen keys. Keep Single-flight, TTL, retries and sizes unchanged. Compare the saved caller counts, evictions, database fetches and balancer timeouts; confirm one change. This preserves the data demand while removing the avoidable source work.",
    "Restore the starter and try a longer TTL, a bigger database and disabled retries. None meets this objective; entries are evicted before expiry, the scenario fixes the reduced CPU capacity, and retries rescue some callers. Smaller increases in cache capacity can also pass this fixed run. Narrowing the keyspace to one also passes, but changes the modeled data demand rather than protecting the sixteen-key service."],
  experiment: {challengeId: "trace-a-slowdown-cascade", prediction: "Will overall health look Healthy after the database recovers even though callers failed?",
    evidenceToInspect: ["LB retries (cumulative)", "Cache: Evictions", "Cache: Expirations", "Application helper: Database fetches", "Application helper: Coalesced waiters"]},
  limitations: ["Results are educational model outputs with an authored slowdown, sizes and timeouts, not provider benchmarks.",
    "Only this fixed, read-only keyspace and CPU cut are tested. There is no mutable-data freshness guarantee, provider benchmark or whole-run latency target. Fitting all keys is not the only passing capacity.",
    "A reading missing from the report stays Unknown."],
  followUp: "Write the balancer -> cache -> database diagnosis with saved counters, the recorded CPU cut and the live sample of serving queries. Compare (share-a-cache-fill): why can sharing fills for one key work there yet be insufficient here? Relate this incident to (fit-the-working-set), then explain why shrinking the modeled keyspace changes the question.",
  check: null,
};
