import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const serveStaleOnErrorV1: ChallengeDefinition = {
  engine: "2", id: "serve-stale-on-error", version: 1, title: "Serve stale on error", difficulty: "advanced",
  summary: "When the database is down, an expired cache entry can still answer. Choose how stale an answer you will accept.",
  concepts: ["Stale-if-error", "Availability versus freshness", "Bounded staleness", "Root cause versus symptom"],
  story: ["A read service keeps one hot item in a cache whose entries expire after one second, so normal answers are always fresh. At second 3 the database crashes for thirty seconds.",
    "Every expiry now needs a refill from the database, and the refill fails. Callers fail with it. The team accepts answers up to a minute old during an outage, but wants normal answers to stay fresh."],
  objective: "Through second 33, complete at least 6500 callers with at most 40 unsuccessful, keep the one-second TTL, and serve at least 100 answers from expired entries no older than 60 seconds.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "200 reads/s for one hot key, steady. The database crashes at second 3 and stays down through second 33.",
  evaluationSeconds: 33, evaluationNote: "Cumulative caller outcomes and cache counters through second 33, the outage's last active second.",
  experiment: {fault: DeploymentChaosNames.Crash, atSimulatedSecond: 3, target: {resourceId: "db", type: "Database"},
    hypothesis: "Can callers be answered while the database is down without giving up one-second freshness?"},
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "callers", kind: "caller-outcomes", label: "Complete 6500 callers with at most 40 unsuccessful through second 33", minCompleted: 6500, maxUnsuccessful: 40},
    {id: "stale", kind: "cache-stale-answers", label: "Serve 100 stale answers no older than 60 seconds, with the TTL at one second", resourceId: "cache", minStaleServed: 100, maxStaleAgeSeconds: 60, maxTtlSeconds: 1}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 33, with the database still down?"}],
  hints: ["Compare the cache's hits, misses and expirations with whole-run failed callers. Failures start when an entry expires and its refill cannot succeed.",
    "A bigger database or more retries cannot answer while the database is down. A longer TTL keeps answers but gives up normal freshness.",
    "Select cache. Set Serve stale after expiry (seconds) to a bound you accept, such as 60. Keep the one-second TTL."],
  debrief: ["With the database down, every refill fails and expired entries are removed, so callers fail. A stale bound keeps expired entries for that long and answers a failed refill from them, counting each answer as stale.",
    "A bigger database does not help because it is still down; extra retries only repeat failing fills; a longer TTL keeps serving the same entry but makes every normal answer that old. Stale-if-error keeps normal answers fresh and trades freshness only while errors last.",
    "Stale answers are not correct for every kind of data: this is only safe where an old answer is acceptable. The bound, outage and workload are educational inputs; a stale answer is never counted as fresh. Not verified: real cache behaviour or invalidation of stale data beyond what is recorded here.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60},
      retry: {enabled: true, maxAttempts: 2, backoffMs: 1, jitterRatio: 0.2, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"]}}],
    ["app", "Virtual Machine", 1, 0],
    ["cache", "Cache", 2, 0, {cachePolicy: {version: 2, capacityEntries: 16, ttlSeconds: 1, singleFlight: false}}],
    ["db", "Database", 2, 1, {size: "small", dataKeyspace: {version: 1, count: 1, accessPattern: "uniform"}}]],
  [["lb", "app"], ["app", "cache"], ["app", "db"]]),
};
