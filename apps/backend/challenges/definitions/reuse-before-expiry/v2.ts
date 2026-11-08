import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const reuseBeforeExpiryV2: ChallengeDefinition = {
  engine: "2", id: "reuse-before-expiry", version: 2, title: "Reuse before expiry", difficulty: "core",
  summary: "Keep reusable reads cached long enough when the whole working set already fits.",
  concepts: ["Cache TTL", "Expiry versus eviction", "Cache-aside misses", "Completed-request latency"],
  story: ["A read-only service offers 1000 reads/second across 256 uniformly selected logical database keys. Its cache already holds 256 entries, but values expire one second after each successful fill. No writes invalidate them.",
    "The app and database both remain Healthy. That label does not prove the required response-time tail: a miss still pays for a database fetch. Compare expiry with eviction before buying more cache space."],
  objective: "Complete at least 5900 callers without unsuccessful callers through second 6, with completed-request p95 at most 4.5 ms in second 6. Test a TTL-only change.",
  workload: {targetThroughput: 60000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Authored: 1000 reads/s, 256 uniformly selected keys, no writes, no retries. The cache starts empty; capacity already fits the keyspace.",
  evaluationSeconds: 6,
  evaluationNote: "Latency scores completions in second 6 only. Cumulative caller outcomes include the initial fills; no whole-run latency SLO is claimed.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "caller-outcomes", label: "Complete 5900 callers without unsuccessful callers through second 6", minCompleted: 5900, maxUnsuccessful: 0},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 4.5 ms in second 6", maxMs: 4.5}],
  predictions: [{id: "database", kind: "database-health", prompt: "Will the starter database record Healthy even when the latency requirement fails at second 6?"}],
  hints: ["Compare CPU and p95 in the report. Inspect live cache expirations and evictions separately; extra space cannot extend a value's lifetime.",
    "Select cache. Under Cache behavior, change Cache TTL from 1 to 60 seconds. Keep Logical cache capacity, Single-flight, topology and workload unchanged.",
    "As a near miss, restore the one-second TTL and increase only logical capacity to 512 entries. There was already room for every key."],
  debrief: ["A cache miss adds a source read even when both resources are Healthy. In these controlled runs, a longer TTL lets the read-only working set stay reusable; compare the saved second-6 latency and database CPU alongside cumulative caller outcomes.",
    "Saved Cache: Hits, Cache: Misses, Cache: Expirations and Cache: Evictions count cache commands through the snapshot, separately from original callers. Application helper: Database fetches records source work. Missing or null counters stay Unknown; these populations do not establish a caller hit ratio. Cache hits do not refresh the fill-based expiry time. More capacity cannot prevent expiry.",
    "These fixed keys, timing and CPU demands are educational assumptions. There are no writes, invalidations or freshness requirements here. A longer TTL is not a general recommendation for mutable data; no consistency, whole-run latency or production availability guarantee is tested.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {skuId: "c5.xlarge"}],
    ["cache", "Cache", 1, 0, {cachePolicy: {version: 2, capacityEntries: 256, ttlSeconds: 1}}],
    ["db", "Database", 2, 0, {size: "small", dataKeyspace: {version: 1, count: 256, accessPattern: "uniform"}}]], [["app", "cache"], ["cache", "db"]]),
};
