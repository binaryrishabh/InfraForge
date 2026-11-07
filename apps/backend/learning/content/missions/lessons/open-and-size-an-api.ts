import type { LearningLesson } from "@infraforge/contracts/learning";

export const openAndSizeAnApi: LearningLesson = {
  id: "open-and-size-an-api", contentVersion: 1, trackId: "missions", moduleId: "guided-missions",
  title: "Open the path, then size the app", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Combine two earlier ideas on a short steady API run: firewall rule priority and app capacity.",
  prerequisites: ["firewall-rule-matching", "find-the-denying-rule", "where-does-the-time-go"],
  problem: ["An inherited API offers 400 reads each second. A quarantine rule blocks its database dependency, and the generic small app also lacks capacity for this steady load. Fixing either problem alone is insufficient.",
    "Through second 6, complete deployment checks, retain fw with positive admissions and no policy or flow-capacity refusals, and complete at least 2300 callers with no unsuccessful callers. Keep the database, topology, workload and flow capacity fixed."],
  explanation: ["Predict health and run unchanged. Read the database's incoming rule counters and fw's policy denials. Cite the denying rule before editing; idle database CPU alone does not explain a failure.",
    "Select fw > Firewall policy. Change quarantine-db Priority from 0 to 20, after allow-app-db at 10. Run again with the original app. Which single requirement still fails? Compare app CPU, Whole run: Completed, Failed and In-flight.",
    "Select app > Instance size > Provider > AWS > c5.large. Combine both changes and compare with the partial report. Then restore the original rule while retaining that app size: explain why buying capacity cannot permit a blocked dependency.",
    "Try c5.xlarge with the corrected rule as another valid design. Compare app CPU, completions and the saved Monthly estimate. Explain whether extra headroom helps this workload before moving on to the existing catalogue burst mission."],
  experiment: {challengeId: "open-and-size-an-api", prediction: "Which problem will remain after correcting only the firewall rule, and what health will your current design record?",
    evidenceToInspect: ["Denied admissions; Backend deliveries; Denied by rule", "Tracked state admissions; Policy denied new admissions; Flow capacity refusals", "CPU; Overall health; p95", "Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Monthly estimate (CostEstimate gate)"]},
  limitations: ["Results are educational model outputs. Instance size changes assumed CPU and default worker slots together. This experiment does not isolate those properties or predict provider performance.",
    "Firewall admissions include probes and count connections, not callers. The caller requirement covers cumulative outcomes through the evaluation second; in-flight work is a separate population. Missing evidence stays Unknown.",
    "The p95 observation covers completed requests in the final second. Neither that observation nor Healthy terminal health establishes continuous health, a whole-run latency SLO or production availability.",
    "Prices are catalog snapshot figures, not a quote. Authentication, application correctness and provider security certification are unverified. There is no fault, burst, cache or dynamic scaling in this mission."],
  followUp: "Next: catalogue-link-flash (Serve a flash of popular links) adds a burst and cache working-set capacity. First cite both partial reports and explain why the policy-only near miss fails exactly the caller-work requirement.",
  check: {question: "Why can the corrected firewall still leave the mission failing?", choices: [{id: "capacity", text: "The app still lacks capacity to complete the required caller work"}, {id: "scan", text: "A completed exposure scan guarantees enough capacity"}],
    correctChoiceId: "capacity", explanation: "Rule priority permits the dependency. It cannot execute the app's CPU work; test app capacity separately with the same workload."},
};
