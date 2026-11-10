import type { LearningLesson } from "@infraforge/contracts/learning";

export const scaleOnDeliveredSamples: LearningLesson = {
  id: "scale-on-delivered-samples", contentVersion: 1, trackId: "observability", moduleId: "monitoring-control",
  title: "Scale on delivered samples", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "See an autoscaler hold because the measurements it trusts have not arrived, then restore its input with one monitoring change.",
  prerequisites: ["monitoring-loss-and-freshness", "move-monitoring-samples"],
  problem: ["A busy app server is autoscaled on measurements delivered to a monitoring backend. Run the starter and find out why the pool never grows."],
  explanation: ["Predict whether the pool gains a server. Then read the pool's startup readings: evaluations, missing measurements, desired count and in-service count, beside the monitor backend's measurement age.",
    "Select monitor and change only Export interval from 20 seconds to 2 seconds. Keep collection at two seconds, the eight-second freshness bound and the CPU target. Compare the two saved reports and confirm the change review counts one change.",
    "The faster export lets complete, fresh measurement pairs reach the backend. The controller then evaluates real utilisation, desires a second server, and the new server becomes listener-ready and enters service.",
    "Restore the starter and lower only the CPU target as a near miss. A lower target sounds more aggressive, but the missing measurements still hold the decision: no valid input ever reaches the target."],
  experiment: {challengeId: "scale-on-delivered-samples", prediction: "By second 90, will the autoscaled pool have an extra app server?",
    evidenceToInspect: ["Desired replicas (current)", "LB-eligible replicas (current)", "Controller evaluations (cumulative)", "Controller missing measurements (cumulative)",
      "Scaling signal freshness bound (us)", "Monitoring backend: Measurement age"]},
  limitations: ["Results are educational model outputs with fixed synthetic timings, not provider benchmarks, safe freshness thresholds or tuning advice.",
    "The lab teaches one control-loop consequence: missing delivered measurements hold the pool. It does not model alerting, adaptive targets, queue-driven scaling or a real autoscaler.",
    "Callers are served in every variant of this light workload, so no outcome claim is made about user impact. A reading missing from the report stays Unknown."],
  followUp: "Cite the starter, the change to the export interval and the near miss that only lowered the CPU target. Explain why a fresh collector and a lower target cannot replace delivered measurements.",
  check: null,
};
