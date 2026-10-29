import { DeploymentChaosNames, RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Model 2 pooling exercise. Historical v1 and cache-failure remain unchanged.
export const afterTheCacheReturnsV2: ChallengeDefinition = {
  engine: "2", id: "after-the-cache-returns", version: 2, title: "After the cache returns", difficulty: "advanced",
  summary: "The cache restarts during a traffic burst while the database still carries work. Give the database enough headroom.",
  concepts: ["Cache-aside fallback", "Per-instance connection pools", "Post-fault observation"],
  story: [
    "A catalogue normally serves 600 requests per second, 90% reads and 10% writes. An authored fourfold burst runs from second 120 to 140. Eight small app instances can scale to 24 at a 20% CPU target in both the control and outage runs; each owns its database connections. The database is the smallest catalog PostgreSQL tier.",
    "The cache crashes at second 105 for 30 seconds, then takes one second to restart. Second 137 is its first available sample. Inspect cache and database separately at second 137, while the burst continues: returning cache service does not erase database work or open sessions. Writes still reach the database and invalidate the cached key.",
  ],
  objective: "Keep overall health Healthy at second 137, with spare database session capacity, for $1,000 a month or less. Keep the cache on the serving path.",
  workload: { targetThroughput: 36000, throughputUnit: "per-minute", trafficShape: "peak", peakMultiplier: 4, readWriteRatio: 0.9, payloadSize: "light" },
  workloadNote: "Authored: 600 requests/s; 2,400/s at seconds 120–140; 90% reads, 10% writes, light payloads. Assumed statement CPU: 1 ms/read, 2 ms/write.",
  evaluationSeconds: 137, evaluationNote: "The crash ends just after second 135; restart completes just after 136. Evaluate the first cache-available sample at 137, before the burst ends at 140.",
  experiment: { fault: DeploymentChaosNames.Crash, atSimulatedSecond: 105, target: { resourceId: "cache", type: T.Cache }, postFaultObservationSeconds: 2,
    hypothesis: "At second 137, after the cache has returned during the burst, will the whole system also be Healthy?" },
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "health", kind: "overall-health", label: "Overall modeled health is Healthy at second 137", allowed: ["healthy"] },
    { id: "connections", kind: "database-connections", requireSpare: true, label: "The database has strictly positive spare session capacity" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $1,000 or less", maxUsd: 1000 },
  ],
  predictions: [
    { id: "target", kind: "target-health", prompt: "At second 137, what health will the cache record?" },
    { id: "health", kind: "overall-health", prompt: "At second 137, what health will the whole system record?" },
    { id: "database", kind: "database-health", prompt: "At second 137, what health will the database record?" },
  ],
  hints: [
    "A restarted cache changes read demand. Writes and invalidations continue during the burst. Follow database CPU, queued work and sessions as well as cache health.",
    "Each app instance has its own lazy pool, with up to 10 connections. The initial eight pools can open at most 80 sessions; added replicas can exceed the database's unchanged 85-session limit.",
    "A database tier can change CPU capacity and connection headroom. Test one architectural change; another app instance can add database pressure.",
  ],
  debrief: [
    "Cache-aside reads fall back independently when the cache times out; there is no single-flight and no automatic retry in this canvas profile. Each app replica owns a separate database pool.",
    "The burst scales out the app in both runs. With a healthy cache, hits keep the database Healthy with spare sessions. During the outage, independent fallback reads fill the pools; added replicas arrive before session refusals. At second 137 the cache is Healthy while queued and active database work and full sessions remain. Changing only to db.m5.xlarge adds CPU capacity and session headroom.",
    "Returning cache service does not end the burst or its writes and invalidations. In the starter, the database remains unhealthy at samples 137–141 after cache return; excess work drains at 141 and health is Healthy at 142. Database health uses CPU consumed over the preceding sample interval and recent errors, including refused sessions even when no SQL statement starts; idle sessions alone do not imply Saturated health.",
    "The authored cache deadline is 10 ms. Database statement and transaction deadlines remain 1 s and 2 s, unlike PostgreSQL's disabled defaults; idle connections can last another 10 s. The load generator allows 512 concurrent serial connections. These educational values are not provider performance guarantees. A retained Healthy sample does not establish continuous recovery.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["app", T.VirtualMachine, 2, 1, { skuId: "t3.micro", autoscaling: { enabled: true, minReplicas: 8, maxReplicas: 24, targetCpu: 20 } }],
    ["cache", T.Cache, 3, 0], ["db", T.Database, 4, 1, { skuId: "db.t3.micro" }],
  ], [["dns", "lb"], ["lb", "app"], ["app", "cache"], ["app", "db"]]),
};
