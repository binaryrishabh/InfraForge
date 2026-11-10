import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const fitTheWorkingSetV1: ChallengeDefinition = {
  engine: "2", id: "fit-the-working-set", version: 1, title: "Fit the working set", difficulty: "core",
  summary: "A cache too small for the keys in use keeps evicting entries it needs. Tell eviction apart from expiry before changing anything.",
  concepts: ["Cache capacity", "Eviction versus expiry", "Working set", "Cache-aside misses"],
  story: [
    "A read-only service offers 1000 reads/second across 256 uniformly selected logical database keys. Its cache holds only 16 entries, and values stay fresh for 30 seconds. No writes invalidate them.",
    "Most reads miss because the cache keeps evicting entries before they are asked for again, so the database does the work. Compare evictions with expirations before choosing a setting.",
  ],
  objective: "Complete at least 5900 callers without unsuccessful callers through second 6, with completed-request p95 at most 4.5 ms in second 6 and the database not saturated. Test one cache setting.",
  workload: {targetThroughput: 60000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Authored: 1000 reads/s, 256 uniformly selected keys, no writes, no retries. The cache starts empty.",
  evaluationSeconds: 6,
  evaluationNote: "Latency scores completions in second 6 only. Cumulative caller outcomes include the initial fills; no whole-run latency SLO is claimed.",
  criteria: [
    {id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "caller-outcomes", label: "Complete 5900 callers without unsuccessful callers through second 6", minCompleted: 5900, maxUnsuccessful: 0},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 4.5 ms in second 6", maxMs: 4.5},
    {id: "database", kind: "database-healthy", label: "Database health is Healthy in second 6"},
  ],
  predictions: [{id: "database", kind: "database-health", prompt: "What database health will the starter record at second 6?"}],
  hints: [
    "Compare database CPU with the cache's hits, misses, expirations and evictions. A 30-second lifetime is not the limit when entries leave the cache early.",
    "A longer lifetime cannot keep an entry that was already evicted, and a larger database only answers the misses faster. Neither changes how many keys the cache can hold.",
    "Select cache. Under Cache behavior, change only Logical cache capacity from 16 to 256 entries. Keep TTL, single-flight, topology and workload unchanged.",
  ],
  debrief: [
    "Sixteen entries cannot hold 256 uniformly used keys, so each fill evicts something that is soon needed again and most reads still go to the database. Raising capacity to the working set lets reads be reused until their lifetime ends, so database work and the latency tail fall.",
    "As a near miss, restore 16 entries and lengthen the TTL to its maximum: nothing expires early, yet entries are still evicted, so the result does not change. Choosing a bigger database also leaves the tail where it was because the misses remain.",
    "This is the mirror of reuse-before-expiry: there the working set already fit and expiry was the problem. Cache counters are cumulative cache commands, not a caller hit ratio. The keys, timing and CPU demands are educational assumptions; no consistency, whole-run latency or availability guarantee follows.",
    MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {skuId: "c5.xlarge"}],
    ["cache", "Cache", 1, 0, {cachePolicy: {version: 2, capacityEntries: 16, ttlSeconds: 30}}],
    ["db", "Database", 2, 0, {size: "small", dataKeyspace: {version: 1, count: 256, accessPattern: "uniform"}}]], [["app", "cache"], ["cache", "db"]]),
};
