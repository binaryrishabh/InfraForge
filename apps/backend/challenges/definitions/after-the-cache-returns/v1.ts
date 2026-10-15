import { DeploymentChaosNames, RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

const APPS = ["app-1", "app-2", "app-3", "app-4", "app-5"];

// Published. Immutable: changes ship as the next version.
export const afterTheCacheReturnsV1: ChallengeDefinition = {
  id: "after-the-cache-returns", version: 1, title: "After the cache returns", difficulty: "advanced",
  summary: "The cache fault ends, but the experiment continues. Watch the target, the database and delayed pool changes separately.",
  concepts: ["Post-fault observation", "System health", "Connection headroom"],
  story: [
    "A read-heavy catalogue runs on five app servers, a cache and a database. The pool can add capacity when average app CPU stays above 50%.",
    "InfraForge crashes the cache at second 60. The modeled fault ends after tick 90, then the experiment observes 45 more seconds. A healthy cache sample does not tell you what the rest of the system will do next.",
  ],
  objective: "At evaluation second 135, keep the whole modeled system Healthy and database connections within its limit, for $500 a month or less.",
  workload: { targetThroughput: 1_080_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.95, payloadSize: "medium" },
  workloadNote: "300 requests per second, steady, 95% reads, medium payloads.",
  evaluationSeconds: 135, evaluationNote: "Evaluate at second 135: 30 seconds of injected crash, then 45 seconds of post-fault observation.",
  experiment: { fault: DeploymentChaosNames.Crash, atSimulatedSecond: 60, target: { resourceId: "cache", type: T.Cache },
    postFaultObservationSeconds: 45,
    hypothesis: "After the cache fault ends at second 90, will the target and the whole system both record Healthy at second 135? Will delayed scale-out change the database's load?" },
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "health", kind: "overall-health", label: "Overall modeled health is Healthy at second 135", allowed: ["healthy"] },
    { id: "connections", kind: "database-connections", label: "Database connections stay within their limit at second 135" },
    { id: "budget", kind: "monthly-budget", label: "Monthly estimate is $500 or less", maxUsd: 500 },
  ],
  predictions: [
    { id: "target", kind: "target-health", prompt: "At evaluation second 135, what health will the cache record?" },
    { id: "health", kind: "overall-health", prompt: "At evaluation second 135, what will overall modeled health be?" },
    { id: "scale", kind: "scale-out", prompt: "By evaluation second 135, will an extra app server be active in the pool?" },
  ],
  hints: [
    "Read the cache and overall-health tracks separately after second 90. An earlier Healthy sample does not promise Healthy at evaluation.",
    "A pool action already provisioning can finish after the fault ends. Inspect replica counts and pending actions in retained samples.",
    "Each serving app server uses a modeled database connection pool. Inspect the database's connection limit as well as its query capacity, then change one thing.",
  ],
  debrief: [
    "Tick 90 still measures the cache crash. The fault ends after that measurement; tick 91 is the first possible post-fault measurement. The database uses the previous tick's cache health, so its pressure can outlast the active fault.",
    "Keep following the retained window. An app server that began provisioning during the fault can join later, and each additional app server adds database connections. Early Healthy samples and health at evaluation answer different questions.",
    "The first retained Healthy sample is an observation at one simulated second. It establishes neither continuous health afterwards nor production availability, request success, latency or data recovery.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 2], ["lb", T.LoadBalancer, 1, 2, { autoscaling: { enabled: true, minReplicas: 5, maxReplicas: 6, targetCpu: 50 } }],
    ...APPS.map((id, row) => [id, T.VirtualMachine, 2, row] as [string, typeof T.VirtualMachine, number, number]),
    ["cache", T.Cache, 3, 2], ["db", T.Database, 4, 2],
  ], [["dns", "lb"], ...fanOut("lb", APPS), ...fanIn(APPS, "cache"), ["cache", "db"]]),
};
