import type { LearningLesson } from "@infraforge/contracts/learning";

export const investigateAPoolReset: LearningLesson = {
  id: "investigate-a-pool-reset", contentVersion: 1, trackId: "advanced", moduleId: "investigation-and-tradeoffs",
  title: "Investigate a pool reset", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Write an incident account from scripted-action receipts and recorded outcomes, preserving missing evidence as Unknown.",
  prerequisites: ["missing-failure-observations", "choose-a-retry-mitigation", "budget-app-database-sessions"],
  problem: ["A 200-read/s service receives a three-second DB CPU reduction at second 2. At second 3 a scripted recovery attempt resets the app-db transport pool. By second 6 both actions have ended, but completed callers can still have a long response tail."],
  explanation: ["Run the starter. Reconstruct the action order from the saved requests and exact application/end receipts. Name db as the CPU target and the materialized app-db path as the pool-reset target. Do not substitute a database restart for a transport reset.",
    "Write six short statements: what failed; what happened next; which components or paths were affected; which facts were retained and which are Unknown; what recovery was attempted; and what later result was observed. Use caller populations, second-6 p95 and final DB health from this report.",
    "A completed reset receipt does not end the CPU intervention. Intermediate samples immediately before and after reset are absent, so whether that attempt immediately improved service is Unknown. A later Healthy DB sample does not erase failed callers or establish recovery time.",
    "Change only lb Maximum attempts from 4 to 2 and run the same script. Compare the tail and whole-run failures. Try 5 separately. Explain the measured difference without inventing incident alerts, operators, users, logs or recovery timestamps."],
  experiment: {challengeId: "investigate-a-pool-reset", prediction: "After CPU capacity returns, can the recorded DB and overall health differ from the earlier caller experience?",
    evidenceToInspect: ["Resolved targets:; Applies at; baseline restore at", "Health; Overall health; p95", "Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Deadline exceeded; Abandoned"]},
  limitations: ["Scenario receipts establish actions and timing, not a continuous incident timeline. There is no retained before/after-reset trace; immediate reset benefit and recovery time remain Unknown.",
    "Results are educational model outputs. The model represents CPU reduction, transport-pool reset, deadlines and bounded retries. It does not represent an operator, DB process restart, external logs or packet-level diagnosis.",
    "The shorter passing completion tail still includes failed callers elsewhere in the run. It proves no availability improvement, whole-run latency SLO or continuous recovery. Incident prose receives no grade."],
  followUp: "Submit an evidence-cited incident account using the six statements. Compare the unchanged and changed runs, distinguish reset completion from capacity restoration, and explicitly mark the immediate recovery result Unknown.", check: null,
};
