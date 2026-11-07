import type { LearningLesson } from "@infraforge/contracts/learning";

export const diagnoseQueryAdmissionV2: LearningLesson = {
  id: "diagnose-query-admission", contentVersion: 2, trackId: "diagnosis", moduleId: "admission-diagnosis",
  title: "Diagnose query admission", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Explain a Healthy database and failed callers before changing the setting that holds useful work back.",
  prerequisites: ["connection-pool-budgets", "trace-a-saturation-cascade"],
  problem: ["The pre-built service offers 1200 reads/s. Callers queue and fail even though the database reports Healthy. Find the constrained setting from run evidence before editing. Through second 6, complete at least 7000 callers without unsuccessful callers; completed-request p95 must be at most 20 ms in second 6."],
  explanation: ["Run unchanged. Inspect DB CPU and Health alongside Serving queries, Queued queries, Queries waiting for locks, Connections and Refused session opens. Compare p95 with Whole run: Failed and Whole run: In-flight. A Healthy database does not establish good caller outcomes.",
    "Write a diagnosis before editing: which saved bound explains queued DB work while CPU is spare, and which counters rule out lock wait and refused session opens? Inspect the database's execution settings, then state a one-change hypothesis. Inspect Duration: Slot hold and Duration: CPU consumption by engine owner, and Duration: Acquired pool wait by source, target and path. Pool totals include only acquisitions that succeeded. Ordinary query phases and unfinished acquisition time remain Unknown; these totals alone do not identify the admission bound.",
    "Change only db Active queries from 1 to 4 and run again. Keep its db.m5.large SKU, queued-query limit, app and workload fixed. Compare both saved reports. As a near miss, restore the starter and change only db to db.m5.xlarge; explain why a lower CPU percentage can coexist with the same failures.",
    "Use the existing prediction choices to predict DB health and busiest resource type. The server checks those measured classifications; it does not grade your written diagnosis. Cite the unchanged and fixed reports to support each link in your explanation."],
  experiment: {challengeId: "diagnose-query-admission", prediction: "Can the database remain Healthy while an admission bound leaves callers waiting or failed?",
    evidenceToInspect: ["CPU; Health; Serving queries; Queued queries", "Queries waiting for locks; Connections; Refused session opens", "p95; Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Duration: Slot hold; Duration: CPU consumption; Duration: Acquired pool wait; Duration: Unfinished acquisition"]},
  limitations: ["Results are educational model outputs. Active queries is a modeled admission gate, not a production PostgreSQL or cloud-provider tuning recommendation. Synthetic CPU work and fixed read traffic do not establish performance for other workloads.",
    "Query and session populations are current samples; the report does not measure each query's session holding time. Connection acquisition wait is not the demonstrated delay, and the run does not show lock contention or session exhaustion.",
    "The p95 requirement covers completions in second 6 and excludes failed or unfinished callers. Cumulative successful callers do not include in-flight work. No whole-run latency SLO, continuous health, recovery time or availability is proved."],
  followUp: "Cite the gate evidence, caller outcomes and near-miss result. Explain why spare CPU did not remove waiting, what the single change establishes, and which missing measurements would leave the diagnosis Unknown.", check: null,
};
