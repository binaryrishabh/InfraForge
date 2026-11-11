import type { LearningLesson } from "@infraforge/contracts/learning";

export const admitAReplicaImage: LearningLesson = {
  id: "admit-a-replica-image", contentVersion: 1, trackId: "scaling", moduleId: "artifact-admission",
  title: "Admit a replica image", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Find the byte admission gate that blocks a later replica, then separate artifact, listener and LB readiness.",
  prerequisites: ["a-replica-must-become-ready", "initial-replicas-and-later-limits"],
  problem: ["The deployed app still serves callers, but the controller wants another replica. Predict the starter's overall health, run unchanged, and record why that desired replica has no ready listener."],
  explanation: [
    "In app's startup measurements, match the artifact replica target to the controller replica id. Compare Required image layer bytes with Artifact cache capacity (bytes), then read the client's startup-failed detail. A cache-capacity refusal before blob admission is a byte gate; CPU and Maximum do not supply bytes.",
    "Record a diagnosis naming the client, required bytes, capacity, refusal reason and missing readiness. Write a one-change hypothesis. Select app, open Autoscaling pool, and change only Artifact cache capacity (bytes). Keep image, Minimum, Maximum, target CPU and instance size fixed. The design review must count exactly one change.",
    "Run again and compare the saved reports at second 20. Artifact-ready time precedes Listener-ready time; current endpoint readiness and LB health settle another gate. The requirement excludes the initially deployed identity and requires at least one later replica to have a measured listener and be currently LB-eligible.",
    "Restore the starter and raise only Maximum as a near miss. Check the real one-change review, repeated byte refusal and Unknown artifact/listener times. Compare Whole run: Completed and Whole run: Failed too: the original app can finish callers in all three runs. Healthy overall health and equal caller totals alone do not prove extra capacity arrived.",
  ],
  experiment: {challengeId: "admit-a-replica-image", prediction: "What overall health will the starter record? Explain whether desired capacity and successful callers establish that the later replica became ready. Only the health choice is scored.",
    evidenceToInspect: ["Required image layer bytes; Artifact cache capacity (bytes); Artifact cached bytes (current)",
      "Artifact pulled bytes (cumulative); Artifact failures (cumulative); Artifact-ready time (us)",
      "Desired replicas (current); LB-eligible replicas (current); Listener-ready time (us)",
      "Replica endpoint alive (current); Replica endpoint ready (current); Replica LB healthy (current); Replica LB draining (current)",
      "CPU; Whole run: Completed; Whole run: Failed; Whole run: In-flight"]},
  limitations: [
    "These are educational model outputs, not cloud benchmarks. The assumed release has one fixed layer and authored provisioning/process-start work; no physical pull-speed, full OCI verification, eviction, prewarming, shared-host reuse or deployment rollout is modeled.",
    "The already deployed replica begins ready without an observed artifact acquisition. Later clients own independent caches. This lab measures a later readiness gate, with no caller throughput improvement: all calibrated variants already finish their callers.",
    "Artifact-ready, listener-ready and current LB health are separate observations. A terminal eligible replica does not establish first traffic, continuous health, recovery time or availability. Missing times and omitted evidence stay Unknown; incomplete readiness evidence cannot meet the requirement.",
  ],
  followUp: "Cite the starter, improved and Maximum-only near miss reports. Name each gate and its evidence, explain why repeated attempts cannot admit an oversized layer, and state what the equal caller totals do and do not prove.",
  check: null,
};
