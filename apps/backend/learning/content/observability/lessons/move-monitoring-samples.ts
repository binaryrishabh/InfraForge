import type { LearningLesson } from "@infraforge/contracts/learning";

export const moveMonitoringSamples: LearningLesson = {
  id: "move-monitoring-samples", contentVersion: 1, trackId: "observability", moduleId: "monitoring-throughput",
  title: "Move monitoring samples", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Test export throughput against buffer capacity using saved collector counts, backend arrivals and backend measurement ages.",
  prerequisites: ["monitoring-loss-and-freshness"],
  problem: ["The collector looks fresh while its backend receives old observations. Run the starter and identify the export throughput deficit before changing a control."],
  explanation: ["Predict overall health using the supported question. Separately write an ungraded hypothesis about local freshness, backend arrivals, pre-export drops and backend measurement age for a larger buffer versus a larger batch.",
    "Select monitor and change only Export batch size from 1 to 16. Keep Buffered samples at 64 and preserve both targets, the workload and timing settings. Compare the two saved reports and verify that the change review counts exactly one change.",
    "Read generated counts beside received counts, duplicates, pre-export drops and each backend target's measurement age. Collector freshness records local observation; it does not show that a recent measurement arrived at the backend.",
    "Restore the starter, then enlarge only Buffered samples as a near miss. Zero drops within this window can coexist with low arrivals and old backend measurements. Explain why waiting room does not remove a sustained export throughput deficit."],
  experiment: {challengeId: "move-monitoring-samples", prediction: "Can the observed service stay Healthy while monitoring samples wait for export?",
    evidenceToInspect: ["Monitoring: Generated samples; Monitoring: Confirmed exports; Monitoring: Dropped before export; Monitoring: Buffered samples",
      "Monitoring backend: Received samples; Monitoring backend: Duplicate samples; Monitoring backend: Measurement age",
      "Monitoring: Collection age; Monitoring: Collection freshness state"]},
  limitations: ["Results are educational model outputs using fixed synthetic collection and export behavior, not provider benchmarks or production tuning recommendations.",
    "The lab proves no real monitoring durability, unique delivery under arbitrary retry ambiguity, continuous freshness or production availability. It does not exercise acknowledgement loss or measure target instrumentation CPU.",
    "Backend received includes duplicate occurrences in the general model. A passing report can still have buffered samples; it is not a complete-delivery claim. Missing identity, counts or age evidence remains Unknown."],
  followUp: "Cite the starter, batch change and larger buffer near miss. Explain why zero drops and a fresh collector label are insufficient pass rules, and distinguish backend arrival time from measurement age.",
  check: null,
};
