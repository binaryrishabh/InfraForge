import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const traceASlowdownCascadeV1: ChallengeDefinition = {
  engine: "2", id: "trace-a-slowdown-cascade", version: 1, title: "Trace a slowdown cascade", difficulty: "advanced",
  summary: "A three-second database slowdown leaves callers failing long after it ends. Trace the chain, then cut it at its source.",
  concepts: ["Cascading failure", "Cache fills under slowdown", "Downstream timeouts and retries", "Root cause versus symptom"],
  story: ["A read service sits behind a load balancer that times out slow backends and retries them within a budget. Each app server asks a cache first and fills a missing entry from the database. Cache entries live one second.",
    "At second 2 the database loses almost all its CPU for three seconds, then recovers. The service should recover with it. Run unchanged and trace where the first bottleneck is, what it feeds, and which of the balancer's retries really matter."],
  objective: "Complete at least 1980 callers with at most 20 unsuccessful through second 10, well after the database recovers. Change one setting.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "200 reads/s for one hot key, steady. The scenario cuts db to 0.002 CPU cores for 3 seconds at second 2.",
  evaluationSeconds: 10, evaluationNote: "Cumulative caller outcomes through second 10, after capacity returns.",
  scenario: {version: 1, visibility: "revealed", steps: [{id: "db-slowdown", atSecond: 2,
    request: {interventionId: "cpu-capacity", revision: 1, target: {resourceId: "db"}, parameters: {cores: 0.002, duration: 3}}}]},
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "callers", kind: "caller-outcomes", label: "Complete 1980 callers with at most 20 unsuccessful through second 10", minCompleted: 1980, maxUnsuccessful: 20}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 10, after the database recovers?"},
    {id: "database", kind: "database-health", prompt: "What will the database's own health be at second 10?"},
    {id: "where", kind: "busiest-resource", prompt: "Which resource will record the highest CPU at second 10?"}],
  hints: ["Compare the LB's downstream timeouts and retry counts, the app's database fetches and the cache's hits and misses. Find where requests first start to wait.",
    "A bigger database or turning retries off leaves the same requests waiting on the same fills.",
    "Change only the cache's Single-flight. Keep the balancer retries, sizes and the cache TTL unchanged."],
  debrief: ["During the slowdown every request for the expired key starts its own database fill, so fills pile up behind a database that can barely serve one. Callers wait past the balancer's downstream timeout and fail; the retry budget limits how many are retried, so retries are a bystander rather than the cause.",
    "Sharing one in-progress fill removes the pile-up at its source. A larger database only changes how long the slowdown looks; turning off retries changes nothing about what waits. A longer cache TTL also helps here by shrinking how often the key must be filled, at the cost of freshness.",
    "Not verified: real cache or balancer behaviour. The slowdown, sizes and timeouts are educational inputs.", MODEL_NOTE],
  starter: starter([["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 60, timeoutSeconds: 60},
      retry: {enabled: true, maxAttempts: 4, backoffMs: 1, jitterRatio: 0.2, maxConcurrentRetries: 64, retryOn: ["backendFailure", "timeout", "connectionFailure"]}}],
    ["app", "Virtual Machine", 1, 0, {skuId: "c5.xlarge", vmExecution: {version: 1, workers: 16, queuedRequests: 32}}],
    ["cache", "Cache", 2, 0, {cachePolicy: {version: 2, capacityEntries: 16, ttlSeconds: 1, singleFlight: false}}],
    ["db", "Database", 2, 1, {size: "small", dataKeyspace: {version: 1, count: 1, accessPattern: "uniform"}}]],
  [["lb", "app"], ["app", "cache"], ["app", "db"]]),
};
