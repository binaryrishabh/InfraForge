import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const scaleOnDeliveredSamplesV1: ChallengeDefinition = {
  engine: "2", id: "scale-on-delivered-samples", version: 1, title: "Scale on delivered samples", difficulty: "advanced",
  summary: "The autoscaler only trusts measurements that reached the backend. When delivery is slow it holds, even while the app server is busy.",
  concepts: ["Autoscaling signal", "Monitoring delivery", "Hold on missing measurements", "One-change experiments"],
  story: ["An autoscaled app server is watched by a monitoring agent. The autoscaler is set to scale only on measurements that the agent has delivered to its backend.",
    "Traffic is steady and the server is busy. The agent collects often but exports rarely, so the newest measurements are old by the time they arrive."],
  objective: "By second 90 the pool must run more than one app server, with the extra server listener-ready and in service, and callers must be served without unsuccessful outcomes. Compare one setting change.",
  workload: {targetThroughput: 6000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 0.8, payloadSize: "light"},
  workloadNote: "100 requests/s, steady, 80% reads and light payloads. No fault or intervention script.",
  evaluationSeconds: 90, evaluationNote: "Pool state is read at second 90; it is a terminal reading, not a continuous availability guarantee.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "scaled", kind: "pool-in-service", label: "The pool has at least 2 app servers in service at second 90", resourceId: "app", minInService: 2}],
  predictions: [{id: "scale", kind: "scale-out", prompt: "By second 90, will the pool have an extra app server?"}],
  hints: ["Open the pool's startup readings: compare evaluations with missing measurements, and the Monitoring backend's measurement age with the autoscaling freshness bound.",
    "A fresh collector does not help. The autoscaler reads only samples that arrived at the backend within its freshness bound.",
    "Select monitor. Change only Export interval from 20 seconds to 2 seconds. Keep collection, freshness and the CPU target."],
  debrief: ["Collection every two seconds with export every twenty means the backend's newest measurements are older than the eight-second freshness bound. Every evaluation finds no usable pair of delivered measurements, so the pool holds at one server.",
    "Shortening only the export interval delivers fresh pairs. The controller then evaluates real utilisation, recommends two servers, and the new one becomes listener-ready and enters service.",
    "Lowering the CPU target looks like a more aggressive scaler, but the missing measurements still hold the decision. The target never gets a valid input.",
    "These are educational timings. This lab does not prove how a real autoscaler or monitoring system behaves, safe freshness thresholds, or availability."],
  starter: starter([["dns", "DNS", 0, 0], ["lb", "Load Balancer", 1, 0],
    ["app", "Virtual Machine", 2, 0, {size: "small", autoscaling: {enabled: true, minReplicas: 1, maxReplicas: 3, targetCpu: 20,
      signal: {version: 1, source: "observed-core-time", monitorId: "monitor", freshForSeconds: 8, stale: "hold"}}}],
    ["monitor", "Monitoring Agent", 2, 1, {monitoringPolicy: {version: 1, collectionIntervalSeconds: 2, exportIntervalSeconds: 20}}],
    ["db", "Database", 3, 0]], [["dns", "lb"], ["lb", "app"], ["app", "db"], ["monitor", "app"]]),
};
