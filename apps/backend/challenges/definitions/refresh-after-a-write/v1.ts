import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const refreshAfterAWriteV1: ChallengeDefinition = {
  engine: "2", id: "refresh-after-a-write", version: 1, title: "Refresh after a write", difficulty: "advanced",
  summary: "Everything reads Healthy, yet callers keep seeing old rows after an update. Find what the cache does on a write.",
  concepts: ["Cache invalidation", "Freshness versus health", "Write path", "TTL is not a freshness fix"],
  story: ["A catalogue service reads and updates 50 rows through a cache whose entries live for 30 seconds. Reads are 75% of the traffic and writes the rest.",
    "Callers, the app and the database all look fine, but the cache keeps handing back rows that were already updated. Compare the cache's hits with the hits that were behind the database."],
  objective: "Through second 30, complete at least 8000 callers with none unsuccessful, serve at least 4000 cache hits, and have at most 100 of the hits behind the database. Test one cache setting.",
  workload: {targetThroughput: 18000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.75, payloadSize: "light"},
  workloadNote: "300 requests/s, 75% reads, spread uniformly over 50 modeled rows. The cache starts empty.",
  evaluationSeconds: 30, evaluationNote: "Cumulative caller outcomes and cache counters through second 30. A hit counts as behind the database when the cached row's version is older than the version the database had committed at that moment.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "callers", kind: "caller-outcomes", label: "Complete 8000 callers with none unsuccessful through second 30", minCompleted: 8000, maxUnsuccessful: 0},
    {id: "fresh", kind: "cache-fresh-reads", label: "Serve at least 4000 cache hits with at most 100 hits behind the database", resourceId: "cache", maxOutdatedHits: 100, minHits: 4000}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the starter record at second 30? Does Healthy mean callers got current rows?"}],
  hints: ["Compare the cache's hits with the hits that were behind the database. A hit that is behind the database is a cache working as configured, not a failure the health bar can see.",
    "A shorter lifetime still leaves a large share of hits behind, because rows are updated more often than that; a bigger app or database changes nothing about which version a hit returns.",
    "Select cache. Turn Invalidate on write back on and change nothing else. Keep the lifetime, topology and workload unchanged."],
  debrief: ["With invalidation off, a committed write leaves the old row in the cache until its lifetime ends, so almost every hit after a row's first update returns an old version. Turning invalidation on removes the entry at each commit, so the next read refills the new row.",
    "As a near miss, restore the setting and cut the lifetime to two seconds: rows are updated more than once a second on average, so a large share of hits are still behind and the database does more fetches. A bigger database or app changes neither count.",
    "Invalidation has a cost and a limit: each write forces a refill, so hits fall and database reads rise; and for rows that rarely change, a short lifetime can be enough. The count is version lag in the model, not application correctness, and the brief window between a commit and its invalidation can still show a few hits behind. Not verified: read-your-writes for one caller, or invalidation across several cache nodes.",
    MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {skuId: "c5.large"}],
    ["cache", "Cache", 1, 0, {cachePolicy: {version: 2, capacityEntries: 256, ttlSeconds: 30, singleFlight: true, invalidateOnWrite: false}}],
    ["db", "Database", 2, 0, {size: "small", dataKeyspace: {version: 1, count: 50, accessPattern: "uniform"}}]],
  [["app", "cache"], ["app", "db"]]),
};
