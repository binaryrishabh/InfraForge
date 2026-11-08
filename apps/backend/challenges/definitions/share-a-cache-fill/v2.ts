import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const shareACacheFillV2: ChallengeDefinition = {
  engine: "2", id: "share-a-cache-fill", version: 2, title: "Share a cache fill", difficulty: "advanced",
  summary: "Share an in-progress read for the same key while the database has less CPU.",
  concepts: ["Single-flight", "Concurrent cache misses", "Database contention"],
  story: ["A read-only service repeatedly requests one logical key. The cache has room for it, but its value expires one second after a successful fill. Concurrent misses can each start another database read before a fill finishes.",
    "At second 2, the scenario reduces database CPU capacity to 0.02 cores for two seconds. Capacity returns just after second 4; the second-5 response-time tail can still include earlier waiting work."],
  objective: "Complete at least 990 callers without unsuccessful callers through second 5, with completed-request p95 at most 50 ms in second 5. Test Single-flight alone.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Authored: 200 reads/second, one logical key, no writes or retries. The cache starts empty, holds 16 entries and has a one-second fill-based TTL.",
  evaluationSeconds: 5,
  evaluationNote: "Latency covers completions in second 5 only; caller outcomes cover the run through second 5. Exact slowdown application and end receipts are required.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "caller-outcomes", label: "Complete 990 callers without unsuccessful callers through second 5", minCompleted: 990, maxUnsuccessful: 0},
    {id: "latency", kind: "terminal-p95", label: "Completed-request p95 is at most 50 ms in second 5", maxMs: 50}],
  predictions: [{id: "database", kind: "database-health", prompt: "Can the starter database record Healthy at second 5 while completed-request p95 still fails its limit?"}],
  hints: ["There is already space for the only key. More logical cache capacity cannot combine overlapping reads for that key.",
    "Select cache. Under Cache behavior, enable only Single-flight. Keep TTL, capacity, topology and workload unchanged.",
    "Compare second-5 p95 and whole-run caller counts. Inspect saved Application helper: Coalesced waiters and Application helper: Database fetches under the same helper owner; they count helper requests, not original callers."],
  debrief: ["Single-flight joins overlapping misses for the same key to one in-progress fetch within an aside owner. It can reduce repeated source work while the database is slow. It does not make the first source read faster.",
    "The controlled comparison changes only Single-flight. The capacity-only near miss still issues independent reads. Saved p95, caller outcomes and database CPU show downstream outcomes. Application helper: Coalesced waiters and Application helper: Database fetches retain cumulative helper diagnostics through the snapshot. The cache targeting-helper waiter total repeats those waiters; do not add it to helper counts. Missing or null counters stay Unknown.",
    "One aside owner and one read-only key are deliberate limits. This is not distributed locking, cross-replica coordination, a freshness check or exactly-once processing. A Healthy terminal sample and a lower second-5 p95 establish neither continuous recovery nor a whole-run latency SLO.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0, {skuId: "c5.xlarge"}],
    ["cache", "Cache", 1, 0, {cachePolicy: {version: 2, capacityEntries: 16, ttlSeconds: 1, singleFlight: false}}],
    ["db", "Database", 1, 1, {size: "small", dataKeyspace: {version: 1, count: 1, accessPattern: "uniform"}}]], [["app", "cache"], ["app", "db"]]),
  scenario: {version: 1, visibility: "revealed", steps: [{id: "db-slowdown", atSecond: 2,
    request: {interventionId: "cpu-capacity", revision: 1, target: {resourceId: "db"}, parameters: {cores: 0.02, duration: 2}}}]},
};
