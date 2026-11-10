import type { LearningLesson } from "@infraforge/contracts/learning";

export const sampleOftenEnough: LearningLesson = {
  id: "sample-often-enough", contentVersion: 1, trackId: "observability", moduleId: "monitoring-throughput",
  title: "Sample often enough", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "See why exporting often cannot make a measurement newer, then collect more often.",
  prerequisites: ["monitoring-loss-and-freshness"],
  problem: ["The agent exports every two seconds yet the backend's view of each target is old. Run the starter and find out what limits its age."],
  explanation: ["Predict overall health, then read generated samples, collection requests and each target's backend measurement age.",
    "Select monitor and change only Collect every (seconds) from 20 to 2. Keep the export interval, batch and buffer unchanged. Compare the two saved reports and confirm one change.",
    "A backend can be no fresher than the newest measurement the agent has taken. More frequent collection gives it newer measurements to deliver.",
    "Restore the starter and shorten only the export interval as a near miss. Samples move sooner but are still as old as the collection interval allows, so the age does not improve."],
  experiment: {challengeId: "sample-often-enough", prediction: "Can the service stay Healthy while the backend's measurements are old?",
    evidenceToInspect: ["Monitoring: Generated samples", "Monitoring: Collection requests", "Monitoring backend: Received samples", "Monitoring backend: Measurement age"]},
  limitations: ["Results are educational model outputs with fixed synthetic timings, not provider benchmarks or tuning advice.",
    "Instrumentation cost of sampling often, durability and continuous freshness are not modeled. A passing report is a terminal-second reading.",
    "A reading missing from the report stays Unknown."],
  followUp: "Cite the starter, the collection change and the near miss that only shortened export. Explain why export frequency cannot create newer measurements.",
  check: null,
};
