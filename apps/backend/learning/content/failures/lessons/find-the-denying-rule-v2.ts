import type { LearningLesson } from "@infraforge/contracts/learning";

export const findTheDenyingRuleV2: LearningLesson = {
  id: "find-the-denying-rule", contentVersion: 2, trackId: "failures", moduleId: "incident-evidence",
  title: "Diagnose a blocked dependency", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Use a failing report to choose an admission cause before editing the design.", prerequisites: ["firewall-rule-matching", "missing-failure-observations"],
  problem: ["Callers fail, yet the database is idle and the exposure scan is clean. These symptoms alone do not tell you which rule to change."],
  explanation: ["Run the starter unchanged. Read caller failures, database CPU and health, then the database's saved security measurements. Look for backend deliveries, missing-listener denials and named rule counters.",
    "Before changing any settings, use that report to choose the database-admission prediction in another unchanged attempt. The server verifies the answer against retained counters. Cite the recorded rule and explain why low CPU and a clean exposure scan are insufficient.",
    "Only after diagnosis, change quarantine-db priority from 0 to 20 on fw. Run again and compare admissions and caller outcomes. Try increasing only fw flow capacity as a separate near miss."],
  experiment: {challengeId: "find-the-denying-rule", prediction: "Which recorded admission cause explains the failed dependency, and can the exposure scan still be clean?",
    evidenceToInspect: ["Denied admissions; No listener; Backend deliveries; Denied by rule", "CPU; Health; Overall health", "Whole run: Completed; Whole run: Failed"]},
  limitations: ["Results are educational model outputs. The diagnosis requires every fixed direct database path and current terminal counters. Missing counters or paths leave the prediction Unknown; replica and helper-path diagnosis is unsupported.",
    "Rule counters include startup probes. They explain modeled admission decisions, not every application error. Packet traces, application correctness and production availability are not recorded.",
    "Exposure-scan findings and runtime reachability are separate checks. Firewall CPU and memory remain Unknown; a Healthy sample does not establish continuous recovery.",
    "Deleting only the deny rule also meets the admission and clean-scan requirements. This lesson retains both rules to isolate their evaluation order."],
  followUp: "Cite the unchanged diagnosis report and the changed report. Name the denying rule, the evidence that supports the diagnosis and one missing measurement that limits your conclusion.",
  check: {question: "Does idle database CPU identify the denying firewall rule?", choices: [{id: "counters", text: "No; inspect the recorded admission and rule counters"}, {id: "cpu", text: "Yes; zero CPU identifies a rule"}],
    correctChoiceId: "counters", explanation: "Idle CPU is a symptom. The retained rule counter identifies the modeled policy decision."},
};
