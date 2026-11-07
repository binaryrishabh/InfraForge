import type { LearningLesson } from "@infraforge/contracts/learning";

export const traceASaturationCascadeV2: LearningLesson = {
  id: "trace-a-saturation-cascade", contentVersion: 2, trackId: "advanced", moduleId: "investigation-and-tradeoffs",
  title: "Trace a saturation cascade", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Connect DB CPU saturation, occupied connections and caller outcomes without inventing an unmodeled queue or retry effect.",
  prerequisites: ["connection-pool-budgets", "retrying-a-full-pool", "budget-app-database-sessions"],
  problem: ["A four-core app receives 800 requests/s, half reads and half writes. Its one-core database executes 1 ms reads and 2 ms writes. The database becomes saturated while the app still has spare CPU and the load balancer reports failed callers."],
  explanation: ["Run unchanged. Trace the dependency path through DB CPU, serving and waiting statements, open sessions, session refusals, typical completed callers' connection-wait contribution, second-6 p95 and cumulative caller outcomes. Also inspect Duration: Slot hold and Duration: CPU consumption by engine owner, then Duration: Acquired pool wait and Duration: Returned remote service by transport path, source and target. Separate these populations and windows.",
    "Change only db to db.m5.large with 2 educational cores. Compare current DB waiting work and connection wait with the changed tail, completions and failures. App CPU can rise when downstream capacity lets more useful work finish.",
    "Enlarge only app as a near miss. Explain why it does not add DB execution capacity. If VM queue or retry counters do not show pressure, do not add those links to the account; demonstrate the cascade that the retained measurements actually support."],
  experiment: {challengeId: "trace-a-saturation-cascade", prediction: "Which tier is busiest, and will relieving it make every component Healthy at the evaluation second?",
    evidenceToInspect: ["CPU; Serving queries; Queries waiting for locks; Connections; Refused session opens", "Connection acquisition wait; p95", "Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Queued at VM (attempts); Refused by VM (attempts)", "Duration: Slot hold; Duration: CPU consumption; Duration: Acquired pool wait; Duration: Returned remote service; Duration: Unfinished acquisition"]},
  limitations: ["Results are educational model outputs. The latency breakdown aggregates transport paths and completed callers. The separate path duration totals include only phases whose end was reached, even if a later phase failed or cancelled. Failed, cancelled and pending acquisitions lack measured wait duration and remain Unknown. Slot hold is cumulative occupied slot time, not a measured app-phase decomposition. None of these totals identifies every waiting millisecond or reconstructs an incident history.",
    "Both variants remain within the database session ceiling with zero session refusals. The demonstrated mechanism is DB CPU/occupied-connection pressure; it is not session exhaustion or proven VM admission-queue pressure.",
    "A faster completion tail and Healthy DB can coexist with a busier, Degraded app. Neither requirement verifies whole-run latency, availability, continuous health or an unmodeled saturation mechanism."],
  followUp: "Cite each supported link from constrained DB execution to waiting work, connection wait and caller outcomes. Explain the busier app after relief and name any tempting causal links the report cannot prove.", check: null,
};
