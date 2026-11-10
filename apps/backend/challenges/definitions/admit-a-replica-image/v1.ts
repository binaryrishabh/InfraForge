import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const admitAReplicaImageV1: ChallengeDefinition = {
  engine: "2", id: "admit-a-replica-image", version: 1, title: "Admit a replica image", difficulty: "core",
  summary: "A later replica cannot own its image layer. Diagnose the startup gate while the deployed app keeps serving.",
  concepts: ["Artifact byte admission", "Replica readiness", "Desired versus usable capacity"],
  story: [
    "One deployed app handles steady reads below its CPU capacity. Its 50% CPU target asks for another replica after ten seconds. Later replicas have a saved 256-byte artifact cache; the assumed release contains one 1024-byte layer.",
    "A desired replica is not yet useful capacity. Resolve the release, admit its layer, start its process and inspect the listener and load balancer separately. Keep the app size, workload and CPU target fixed while testing one change.",
  ],
  objective: "At second 20, have at least one later replica listener-ready and currently LB-eligible, while completing at least 3900 callers with no unsuccessful callers.",
  workload: {targetThroughput: 12000, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "200 read requests/s, light payloads. Authored app work is 3 ms CPU/read; the initial single core has headroom.",
  evaluationSeconds: 20,
  evaluationNote: "One terminal sample at second 20. Later replicas exclude those deployed at time zero. Caller counts cover the whole run, not only its last second.",
  criteria: [
    {id: "checks", kind: "deployment-checks", label: "Complete the deployment checks"},
    {id: "ready", kind: "startup-capacity", label: "At least one later replica is listener-ready and currently LB-eligible at second 20", resourceId: "app", minNewReady: 1},
    {id: "callers", kind: "caller-outcomes", label: "Complete at least 3900 callers with no unsuccessful callers through second 20", minCompleted: 3900, maxUnsuccessful: 0},
  ],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the starter record at second 20, even if the new replica is blocked?"}],
  hints: [
    "Run unchanged. Match the failed artifact client's replica target to the controller identity. Inspect required layer bytes, saved cache capacity and startup-failed detail before CPU.",
    "The initial app can serve without a new pull. An oversized layer still fails on each later attempt; changing Maximum does not enlarge any client's cache.",
    "Select app, open Autoscaling pool, and increase only Artifact cache capacity (bytes) so the complete layer fits with spare bytes. Compare artifact-ready, listener-ready and current LB health in the saved reports.",
  ],
  debrief: [
    "The starter resolves the manifest but refuses its layer with node-blob-cache-capacity. Three attempts cannot fit 1024 bytes into 256. Its initial app stays ready, so Healthy overall health and successful callers do not prove the requested extra capacity arrived.",
    "Changing only the byte limit admits the layer. Acquisition precedes process startup and listener readiness; the load balancer then observes health independently. Raising only Maximum leaves the same byte refusal and no later ready listener.",
    "This is an admission experiment. All calibrated variants complete the same caller population; no throughput gain is claimed. The release is an assumed 1 KiB layer, with educational provisioning and process-start delays. No physical download-speed, shared-host cache, eviction, deployment rollout or availability guarantee follows.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["lb", "Load Balancer", 0, 0, {lbHealth: {version: 1, intervalSeconds: 1, timeoutSeconds: 1}}],
    ["app", "Virtual Machine", 1, 0, {size: "small", autoscaling: {enabled: true, minReplicas: 1, maxReplicas: 2, targetCpu: 50}, artifactCachePolicy: {version: 1, capacityBytes: 256}}],
  ], [["lb", "app"]]),
};
