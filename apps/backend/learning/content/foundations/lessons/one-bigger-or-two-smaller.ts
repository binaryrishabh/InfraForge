import type { LearningLesson } from "@infraforge/contracts/learning";

export const oneBiggerOrTwoSmaller: LearningLesson = {
  id: "one-bigger-or-two-smaller", contentVersion: 1, trackId: "foundations", moduleId: "first-runs",
  title: "Compare two ways to add capacity", kind: "executable-lab", level: "beginner", availability: "available",
  summary: "Compare one larger app with two smaller apps at the same steady request rate.",
  prerequisites: ["virtual-machines", "more-users-more-pressure"],
  problem: ["One app fits a lower request rate but queues work at 800 reads each second. The same request path now needs more capacity."],
  explanation: ["The runnable lab fixes traffic at 800 requests/second. Keep that workload unchanged while comparing designs.",
    "First change app from c5.large to c5.xlarge. Then restore c5.large and add a second c5.large, connecting lb to the new app and the new app to db.",
    "Compare CPU, completed throughput, p95 and the educational monthly estimates. Equal estimates are a valid result; do not assume one layout must be cheaper."],
  experiment: {challengeId: "one-bigger-or-two-smaller", prediction: "Which resource type will have the highest CPU at second 12 for each design?",
    evidenceToInspect: ["CPU; Health; Overall health", "Completed requests/s; Failed requests/s; p95", "Monthly estimate (CostEstimate gate)"]},
  limitations: ["Results are educational model outputs. Catalog labels and monthly estimates are fixed educational inputs, not current provider quotes or cloud performance benchmarks.",
    "No outage is applied. Two app instances do not establish failover, outage tolerance or availability; the load balancer and database remain shared dependencies.",
    "p95 is a last-second measurement of completed requests, not a whole-run SLO. The lower-rate control is a separate calibration, not a second scored workload."],
  check: null,
  followUp: "Record both passing estimates and explain which cost and failure claims these runs leave Unknown.",
};
