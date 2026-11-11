import type { LearningLesson } from "@infraforge/contracts/learning";

export const traceAScalingStall: LearningLesson = {
  id: "trace-a-scaling-stall", contentVersion: 1, trackId: "diagnosis", moduleId: "capstone-cascades",
  title: "Trace a scaling stall", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Follow a stalled scale-out from failing callers back through the pool, the controller and the measurements to the first gate.",
  prerequisites: ["a-replica-must-become-ready", "scale-on-delivered-samples"],
  problem: ["One busy app cannot finish the traffic, callers fail and the pool never grows. Run the starter and trace why before choosing a fix."],
  explanation: [
    "Predict overall health and which resource will show the highest CPU. Then write the trace list in order: failed callers, the busy app, the pool's desired count, the controller's evaluations with no usable measurement, the measurements' age against the freshness bound, and the agent's export interval.",
    "Decide which link is the first gate and which links only sit after it. Write one change for each plausible fix before running any: a higher maximum, a larger artifact cache, a bigger app.",
    "Select monitor and change only Export interval. Keep collection, the freshness bound, the CPU target and the pool limits. Run again and confirm one change in the review.",
    "Restore the starter and try the other fixes as near misses. A higher maximum and a larger cache change nothing because the controller never asks for a replica; a bigger app serves callers but leaves the pool at one server and the controller blind, so the scaling requirement still fails."],
  experiment: {challengeId: "trace-a-scaling-stall", prediction: "What overall health will be recorded at second 90, and which resource will show the highest CPU? Both are scored.",
    evidenceToInspect: ["CPU; Overall health", "Desired replicas (current); LB-eligible replicas (current)", "Whole run: Completed; Whole run: Failed; Whole run: In-flight"]},
  limitations: [
    "Results are educational model outputs with authored timings, sizes and traffic, not provider benchmarks.",
    "Only the chain recorded here is traced. A second gate such as a too small artifact cache can hide behind the first; here it is roomy, so it never opens, and a passing run does not show the pool would grow under a different failure.",
    "Highest CPU is a recorded reading, not a diagnosis. Fixed-second readings prove no continuous availability, and a reading missing from the report stays Unknown."],
  followUp: "Write the chain in order and cite the starter and the export change. Explain why a higher maximum and a larger cache could not help, and why a bigger app still failed the scaling requirement. Then compare admit-a-replica-image, the second gate this lab leaves closed.",
  check: null,
};
