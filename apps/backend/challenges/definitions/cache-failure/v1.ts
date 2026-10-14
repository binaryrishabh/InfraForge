import { DeploymentChaosNames, RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

const APPS = ["app-1", "app-2", "app-3", "app-4"];

// Published. Immutable: any change, even to wording, ships as the next version file.
export const cacheFailureV1: ChallengeDefinition = {
  id: "cache-failure", version: 1, title: "When the cache fails", difficulty: "advanced",
  summary: "A read-heavy API leans on its cache. The cache crashes, and the database has to cope on its own.",
  concepts: ["Cache dependency", "Database headroom", "Failure modes"],
  story: [
    "A product catalogue serves 900,000 requests an hour, 95% of them reads. A cache in front of the database answers most of them, and the database was sized for what is left.",
    "InfraForge will crash the cache at simulated second 60, once traffic has finished ramping up. The model keeps a crashed resource down for 30 seconds, and every read the cache was absorbing heads for the database.",
  ],
  objective: "While the cache is down, keep every other resource out of saturation at the last second of the outage, for $400 a month or less.",
  workload: { targetThroughput: 900_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.95, payloadSize: "medium" },
  workloadNote: "900,000 requests per hour, steady, 95% reads, medium payloads.",
  evaluationSeconds: 90, evaluationNote: "Checked at simulated second 90, the last second the cache is down.",
  experiment: {
    fault: DeploymentChaosNames.Crash, atSimulatedSecond: 60, target: { resourceId: "cache", type: T.Cache },
    hypothesis: "The cache crashes at simulated second 60 and stays down for 30 seconds. Will the database cope with every read on its own at second 90?",
  },
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "survivors", kind: "survivors-unsaturated", label: "Apart from the cache, no resource saturated or failed at second 90" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $400 or less", maxUsd: 400 },
  ],
  predictions: [
    { id: "baseline", kind: "baseline-health", prompt: "What will overall health be at second 60, just before the cache crashes?" },
    { id: "database", kind: "database-health", prompt: "At second 90, with the cache down, what will the database's health be?" },
  ],
  hints: [
    "With the cache working, the database sees only the reads the cache misses, plus the writes. Work out what it sees when every read arrives.",
    "In this model, when a cache in front of a database fails, that database stops benefiting from caching, and it also takes extra load because something feeding it has failed. A second cache in front of the same database does not change that.",
    "Size the database for the load without the cache, not the load with it. In this catalog a database's query capacity grows with its vCPUs.",
  ],
  debrief: [
    "About 250 requests per second arrive. With the cache, the database handles roughly 72 queries per second, under a third of a generic database's 250. Without it every read reaches the database: about 262 queries per second, more than a generic database can serve.",
    "The database also takes extra load in this model while a resource feeding it has failed, so during the outage it needs headroom beyond the raw query count. A db.m5.xlarge (4 vCPU, about 500 queries per second) stays healthy; the starter's generic database saturates.",
    "The app servers work harder too while the cache they send requests to is down, but four of them still have room. The cache made normal operation cheap; the database's size decides what happens when the cache is gone.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1],
    ["app-1", T.VirtualMachine, 2, 0], ["app-2", T.VirtualMachine, 2, 1], ["app-3", T.VirtualMachine, 2, 2], ["app-4", T.VirtualMachine, 2, 3],
    ["cache", T.Cache, 3, 1], ["db", T.Database, 4, 1],
  ], [["dns", "lb"], ...fanOut("lb", APPS), ...fanIn(APPS, "cache"), ["cache", "db"]]),
};
