import { DeploymentChaosNames, RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Model 2 pooling exercise. Historical v1 and cache-failure remain unchanged.
export const afterTheCacheReturnsV2: ChallengeDefinition = {
  engine: "2", id: "after-the-cache-returns", version: 2, title: "After the cache returns", difficulty: "advanced",
  summary: "The cache restarts while the database still carries work from the outage. Give the database enough headroom.",
  concepts: ["Cache-aside fallback", "Per-instance connection pools", "Post-fault observation"],
  story: [
    "A catalogue serves 2,400 reads per second from a cache. Its app pool has 32 small instances, each owning its database connections. The database is the smallest catalog PostgreSQL tier.",
    "The cache crashes at second 10 for 30 seconds, then takes one second to restart. At the first return sample, second 42, inspect the cache and the database separately: queued work and open sessions survive the cache restart.",
  ],
  objective: "Keep overall health Healthy at second 42, including database headroom, for $1,000 a month or less. Keep the cache on the serving path.",
  workload: { targetThroughput: 144000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light" },
  workloadNote: "2,400 requests per second, all reads, light payloads. This is an authored educational workload.",
  evaluationSeconds: 42, evaluationNote: "The crash ends at second 40; the cache restarts just after second 41; second 42 is its first available sample. Evaluate that first return sample.",
  experiment: { fault: DeploymentChaosNames.Crash, atSimulatedSecond: 10, target: { resourceId: "cache", type: T.Cache }, postFaultObservationSeconds: 2,
    hypothesis: "When the cache becomes available at second 42, will the whole system also be Healthy?" },
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "health", kind: "overall-health", label: "Overall modeled health is Healthy at second 42", allowed: ["healthy"] },
    { id: "connections", kind: "database-connections", label: "Open database sessions are within the database's connection limit" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $1,000 or less", maxUsd: 1000 },
  ],
  predictions: [
    { id: "target", kind: "target-health", prompt: "At second 42, what health will the cache record?" },
    { id: "health", kind: "overall-health", prompt: "At second 42, what health will the whole system record?" },
    { id: "database", kind: "database-health", prompt: "At second 42, what health will the database record?" },
  ],
  hints: [
    "A restarted cache changes new demand. Follow the database's CPU and connections as well as cache health.",
    "Each app instance has its own lazy pool, with up to 10 connections. App replicas do not increase the database's catalog connection limit.",
    "A database tier can change CPU capacity and connection headroom. Test one architectural change; another app instance can add database pressure.",
  ],
  debrief: [
    "Cache-aside reads fall back independently when the cache times out; there is no single-flight and no automatic retry in this canvas profile. Each app replica owns a separate database pool.",
    "In the starter run at second 42, the cache is Healthy while the database has 85 of 85 sessions and remains Saturated even at 4.2% CPU: refused sessions still count as errors. Changing only to db.m5.xlarge gives 63 of 1,360 sessions and Healthy overall health at that sample.",
    "The cache is available at the evaluation sample, but that does not erase pool waiters, database work or already-open sessions. Refused database sessions count as errors even when a SQL statement never starts.",
    "The authored cache deadline is 10 ms. Database statement and transaction deadlines are 1 s and 2 s, unlike PostgreSQL's disabled defaults. The unhealthy tail is short in this exercise; idle connections can last another 10 s. A retained Healthy sample does not establish continuous recovery.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["app", T.VirtualMachine, 2, 1, { skuId: "t3.micro", autoscaling: { enabled: true, minReplicas: 32, maxReplicas: 32, targetCpu: 60 } }],
    ["cache", T.Cache, 3, 0], ["db", T.Database, 4, 1, { skuId: "db.t3.micro" }],
  ], [["dns", "lb"], ["lb", "app"], ["app", "cache"], ["app", "db"]]),
};

