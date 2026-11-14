import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const traceASlowdownCascadeV1: ChallengeDefinition = {
  engine: "2", id: "trace-a-slowdown-cascade", version: 1, title: "Trace a slowdown cascade", difficulty: "advanced",
  summary: "Single-flight is already on, yet a database slowdown still loses callers. Trace balancer timeouts through cache eviction to competing database reads.",
  concepts: ["Cascading failure", "Single-flight scope", "Eviction versus expiry", "Root cause versus symptom"],
  story: ["A read service behind a retrying load balancer uses sixteen uniformly selected database keys. Its cache holds one entry with a sixty-second TTL. Single-flight already joins overlapping fills for the same key; it cannot combine reads for different keys.",
    "At second 2 the database drops to 0.002 CPU cores for three seconds. Follow the balancer's timed-out attempts, the cache's evictions and source fetches, then database contention during the slowdown. Decide whether retries, expiry or missing reuse explains the lost callers."],
  objective: "Complete at least 1980 callers with at most 20 unsuccessful through second 10, well after the database recovers. Change one setting.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "200 reads/s, 16 uniform keys, no writes; empty cache, Single-flight on. At second 2 db drops to 0.002 cores for 3 seconds.",
  evaluationSeconds: 10, evaluationNote: "Cumulative caller outcomes through second 10, after capacity returns.",
  scenario: {version: 1, visibility: "revealed", steps: [{id: "db-slowdown", atSecond: 2,
    request: {interventionId: "cpu-capacity", revision: 1, target: {resourceId: "db"}, parameters: {cores: 0.002, duration: 3}}}]},
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "callers", kind: "caller-outcomes", label: "Complete 1980 callers with at most 20 unsuccessful through second 10", minCompleted: 1980, maxUnsuccessful: 20}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 10, after the database recovers?"},
    {id: "database", kind: "database-health", prompt: "What will the database's own health be at second 10?"},
    {id: "where", kind: "busiest-resource", prompt: "Which resource will record the highest CPU at second 10?"}],
  hints: ["Start at the LB: distinguish admission refusals from timed-out downstream attempts. Next inspect cache evictions versus expirations, and the app helper's database fetches and coalesced waiters. During the slowdown inspect the database's serving queries and CPU contention.",
    "Single-flight is already working, but only per key. Entries are evicted before their TTL ends. A longer TTL cannot retain an evicted entry; a bigger database is still cut to the same CPU capacity by the scenario.",
    "Change only Logical cache capacity from 1 to 16 entries. Keep Single-flight on, and keep the TTL, keys, balancer retries and sizes unchanged."],
  debrief: ["The balancer records timeouts after database reads contend under the CPU cut. Cache eviction keeps those reads necessary even though same-key fills are already shared. The unchanged no-slowdown control meets the objective without failures, with one caller still in flight. Eviction exposes the service to this slowdown, rather than causing the same loss at normal database capacity. More cache entries retain the warm keys and avoid those reads during the fault.",
    "Sixteen entries completes all callers here; twelve still loses many. Sixteen is a reference, not the only passing capacity: fourteen and fifteen also pass this fixed run. Lengthening TTL alone, enlarging the app queue or selecting a bigger database does not meet the objective. Turning retries off loses more callers, so retries are a mitigation here, not the root cause.",
    "Reducing the database keyspace to one also passes, but changes the modeled data demand. It does not preserve the sixteen-key service. This is a layered incident application of fit-the-working-set; unlike share-a-cache-fill, its starter already shares fills. The terminal Healthy sample hides cumulative caller loss; it does not prove continuous health or recovery time.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60},
      retry: {enabled: true, maxAttempts: 4, backoffMs: 1, jitterRatio: 0.2, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"]}}],
    ["app", "Virtual Machine", 1, 0, {skuId: "c5.xlarge", vmExecution: {version: 1, workers: 16, queuedRequests: 32}}],
    ["cache", "Cache", 2, 0, {cachePolicy: {version: 2, capacityEntries: 1, ttlSeconds: 60, singleFlight: true}}],
    ["db", "Database", 2, 1, {size: "small", dataKeyspace: {version: 1, count: 16, accessPattern: "uniform"}}]],
  [["lb", "app"], ["app", "cache"], ["app", "db"]]),
};
