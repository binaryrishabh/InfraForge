import type { LearningLesson } from "@infraforge/contracts/learning";

export const diagnoseLostAppCapacityV2: LearningLesson = {
  id: "diagnose-lost-app-capacity", contentVersion: 2, trackId: "advanced", moduleId: "investigation-and-tradeoffs",
  title: "Diagnose lost app capacity", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Explain a busy app and idle peer using retained admission evidence before changing the design.",
  prerequisites: ["firewall-rule-matching", "find-the-denying-rule", "leave-room-for-firewall-flows"],
  problem: ["The app and peer each have one core and should share 500 reads/s, but one is saturated and the other serves no callers. The two-core database is Healthy. Diagnose why the apparent app bottleneck exists before treating it."],
  explanation: ["Run unchanged. Inspect app and peer CPU and throughput, both incoming DB admission paths, missing-listener and policy denials, and fw tracked admissions and capacity refusals. The loudest CPU symptom alone cannot identify the cause.",
    "Before editing, submit your evidence-based database-admission choice in another unchanged attempt. Reuse the failures lab workflow: the server checks the prediction against that run's retained counters. Other-or-mixed is a broad classification; cite fw's positive capacity refusals to narrow it.",
    "After verifying the diagnosis, change only fw Tracked connection limit from 1 to 8, then compare both apps' work, admissions, second-6 p95 and whole-run caller failures. Try enlarging app alone as a near miss; explain why fixing a visible symptom can leave a requirement unmet."],
  experiment: {challengeId: "diagnose-lost-app-capacity", prediction: "Which database-admission classification is supported by the unchanged report, and what additional counter narrows the cause?",
    evidenceToInspect: ["Denied admissions; No listener; Denied by rule; Backend deliveries", "Tracked state admissions; Current flow occupancy; Flow capacity refusals; Policy denied new admissions", "CPU; Requests/s; p95", "Whole run: Completed; Whole run: Failed; Whole run: In-flight"]},
  limitations: ["The pre-edit workflow uses existing unchanged attempts; it is not an edit lock or a second diagnosis system. It verifies the selected admission classification, not arbitrary written explanations.",
    "Other-or-mixed alone does not identify a unique cause. Diagnosis requires complete fixed direct DB paths and current safe counters; missing evidence remains Unknown. Probes and callers are different populations.",
    "Results are educational model outputs. Firewall CPU, packet traces and provider behavior are Unknown. Second-6 p95 omits failed and unfinished callers and proves neither continuous health nor a whole-run SLO.",
    "In the calibrated runs a tracked-connection limit of two already admits both app paths with no refusals, and larger limits only add spare room; the starter limit of one refuses the second path, and an app size change alone leaves that refusal."],
  followUp: "Cite your unchanged diagnosis report and changed report. Explain how a refused dependency probe removed useful app capacity, why an app CPU upgrade was incomplete, and which missing measurements limit the conclusion.", check: null,
};
