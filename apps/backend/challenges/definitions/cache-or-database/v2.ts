import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const cacheOrDatabaseV2: ChallengeDefinition = {
  engine: "2", id: "cache-or-database", version: 2, title: "Cache or database", difficulty: "core",
  summary: "Choose cache reuse or database capacity for a fixed read-only hot-key workload.",
  concepts: ["Cache-aside reads", "Hot-key working set", "Database capacity", "Educational cost"],
  story: ["A read service offers 1200 reads/second. Its c5.xlarge app calls a small database directly. The database has sixteen logical keys with the engine's fixed hot-key pattern: most reads use the first key, with the remainder spread across the others.",
    "Requirements: completed-request p95 at most 20 ms in second 6, at least 7000 completed callers with no unsuccessful callers through second 6, and an educational monthly estimate at most $200. Choose between inserting a cache on the app-database path or increasing database capacity. Keep the traffic, app and keyspace fixed."],
  objective: "Meet the latency and educational budget requirements by either caching reads or adding database capacity. Defend the choice with both reports.",
  workload: {targetThroughput: 72000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "1200 reads/s, sixteen fixed hot-pattern keys. No writes or invalidations; this is not a general cache popularity model.",
  evaluationSeconds: 6, evaluationNote: "Latency covers only completions in second 6. Inspect cumulative caller outcomes too; this is not a whole-run SLO.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "caller-outcomes", label: "Complete 7000 callers without unsuccessful callers through second 6", minCompleted: 7000, maxUnsuccessful: 0},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 20 ms in second 6", maxMs: 20},
    {id: "budget", kind: "monthly-budget", label: "Educational monthly estimate is at most $200", maxUsd: 200}],
  predictions: [{id: "busy", kind: "busiest-type", prompt: "Which resource type will have the highest recorded CPU in second 6?"}],
  hints: ["Compare app CPU with database CPU and the latency tail. A larger app cannot execute database work.",
    "Insert a Cache between app and db, holding sixteen logical entries; remove the direct app-db edge. Keep the database and its hot-key keyspace unchanged.",
    "Alternatively keep the direct edge and select db.t3.micro on db. Compare its recorded CPU, p95 and educational estimate with the cache design; do not assume the cache is cheaper."],
  debrief: ["Both designs can meet the same requirement. The cache retains the small database and reuses reads; the database design keeps the direct path and increases writer CPU capacity. Compare recorded CPU and caller populations alongside latency and educational estimate.",
    "The cache design adds a dependency and an educational cost. Its reduced database CPU and latency are specific to this read-only fixed keyspace. Saved Cache: Hits and Cache: Misses count cache commands; Application helper: Database fetches records source work through the snapshot. These populations are separate from original callers and do not establish a caller hit ratio. Missing or null evidence stays Unknown; the direct path has no cache evidence.",
    "No mutable-data consistency, arbitrary popularity, cache outage, provider pricing or whole-run latency guarantee is verified. A database size changes catalog properties together, not CPU alone.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {skuId: "c5.xlarge"}],
    ["db", "Database", 2, 0, {size: "small", dataKeyspace: {version: 1, count: 16, accessPattern: "hot-key"}}]], [["app", "db"]]),
};
