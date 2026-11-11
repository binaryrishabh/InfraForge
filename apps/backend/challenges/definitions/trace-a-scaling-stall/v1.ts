import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const traceAScalingStallV1: ChallengeDefinition = {
  engine: "2", id: "trace-a-scaling-stall", version: 1, title: "Trace a scaling stall", difficulty: "advanced",
  summary: "A busy pool never grows and callers fail. Walk the chain from the failures back to the first gate that stopped the scale-out.",
  concepts: ["Control loop gates", "Delivered measurements", "Replica admission", "Root cause versus symptom"],
  story: [
    "An autoscaled medium app sits behind a load balancer with a monitoring agent. The pool may grow to three servers and later servers have a roomy artifact cache. The autoscaler scales only on measurements the agent has delivered to its backend within eight seconds.",
    "Traffic is steady at about 570 requests/s, more than one app can finish. Callers fail and the pool never grows. Trace the chain in order before changing anything: failures, the busy app, the pool's desired count, the controller's evaluations, the measurements' age and the agent's settings.",
  ],
  objective: "By second 90, have at least 2 app servers in service and complete at least 50500 callers with at most 100 unsuccessful. Change one setting.",
  workload: {targetThroughput: 34000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.8, payloadSize: "light"},
  workloadNote: "About 567 requests/s, steady, 80% reads, light payloads. No fault script.",
  evaluationSeconds: 90,
  evaluationNote: "Pool state is read at second 90 and caller counts are whole-run through second 90. This is a fixed-second reading, not continuous availability.",
  criteria: [
    {id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "scaled", kind: "pool-in-service", label: "The pool has at least 2 app servers in service at second 90", resourceId: "app", minInService: 2},
    {id: "callers", kind: "caller-outcomes", label: "Complete 50500 callers with at most 100 unsuccessful through second 90", minCompleted: 50500, maxUnsuccessful: 100},
  ],
  predictions: [
    {id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 90?"},
    {id: "where", kind: "busiest-resource", prompt: "Which resource will record the highest CPU at second 90?"},
  ],
  hints: [
    "Trace in order: failed callers, the app's CPU, the pool's desired count, the controller's evaluations with missing measurements, the backend's measurement age against the freshness bound, then the agent's collection and export intervals.",
    "A higher maximum, a larger artifact cache and a bigger app each act on a link after the stall. The controller holds the pool before any of them is consulted.",
    "Select monitor and change only Export interval from 20 seconds to 2 seconds. Keep collection, the freshness bound, the CPU target and the pool limits.",
  ],
  debrief: [
    "Chain, in order: callers fail because the single app is saturated; the pool's desired count stays at one; the controller holds because the newest delivered measurements are older than its freshness bound; they are old because the agent exports every twenty seconds. The export interval is the first gate.",
    "Shortening only the export interval delivers fresh measurements, the pool grows and the failures stop. Raising the maximum replicas or enlarging the artifact cache changes nothing, because the controller never asks for a replica and no replica ever needs an image. A bigger app serves the callers, but the pool stays at one server and the controller is still blind, so the scaling requirement is not met.",
    "A second gate can hide behind the first: with a cache too small for the image, fixing the first gate would only reveal replicas that cannot become ready. Here the cache is roomy, so that gate never opens. Educational timings; no real autoscaler, monitoring pipeline or availability guarantee is verified.",
    MODEL_NOTE],
  starter: starter([["dns", "DNS", 0, 0], ["lb", "Load Balancer", 1, 0],
    ["app", "Virtual Machine", 2, 0, {size: "medium", artifactCachePolicy: {version: 1, capacityBytes: 4096}, autoscaling: {enabled: true, minReplicas: 1, maxReplicas: 3, targetCpu: 50,
      signal: {version: 1, source: "observed-core-time", monitorId: "monitor", freshForSeconds: 8, stale: "hold"}}}],
    ["monitor", "Monitoring Agent", 2, 1, {monitoringPolicy: {version: 1, collectionIntervalSeconds: 2, exportIntervalSeconds: 20}}],
    ["db", "Database", 3, 0]], [["dns", "lb"], ["lb", "app"], ["app", "db"], ["monitor", "app"]]),
};
