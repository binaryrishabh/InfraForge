import type { LearningLesson } from "@infraforge/contracts/learning";

export const traceASaturationCascade: LearningLesson = {
  id: "trace-a-saturation-cascade", contentVersion: 1, trackId: "advanced", moduleId: "investigation-and-tradeoffs",
  title: "Trace a saturation cascade", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Connect DB CPU saturation, occupied connections and caller outcomes without inventing an unmodeled queue or retry effect.",
  prerequisites: ["retrying-a-full-pool", "budget-app-database-sessions"],
  problem: ["A four-core app receives 800 requests/s, half reads and half writes. Its one-core database executes 1 ms reads and 2 ms writes. The database becomes saturated while the app still has spare CPU and the load balancer reports failed callers."],
  explanation: ["Run unchanged. Trace the dependency path through DB CPU, serving and waiting statements, open sessions, session refusals, typical completed callers' connection-wait contribution, second-6 p95 and cumulative caller outcomes. Separate these populations and windows.",
    "Change only db to db.m5.large with two educational cores. Compare current DB waiting work and connection wait with the changed tail, completions and failures. App CPU can rise when downstream capacity lets more useful work finish.",
    "Enlarge only app as a near miss. Explain why it does not add DB execution capacity. If VM queue or retry counters do not show pressure, do not add those links to the account; demonstrate the cascade that the retained measurements actually support."],
  experiment: {challengeId: "trace-a-saturation-cascade", prediction: "Which tier is busiest, and will relieving it make every component Healthy at the evaluation second?",
    evidenceToInspect: ["Second-6 DB CPU, serving/waiting statements, open sessions and cumulative session refusals", "Second-6 typical completed-caller connection-wait mean, completion p95 and per-resource CPU", "Whole-run completed, failed and in-flight callers; LB accounting including queued-at-VM and VM refusals"]},
  limitations: ["The latency breakdown aggregates transport paths and completed callers. It does not identify every waiting millisecond's owning pool or include failed and unfinished latency.",
    "Both variants remain within the database session ceiling with zero session refusals. The demonstrated mechanism is DB CPU/occupied-connection pressure; it is not session exhaustion or proven VM admission-queue pressure.",
    "A faster completion tail and Healthy DB can coexist with a busier, Degraded app. Neither requirement verifies whole-run latency, availability, continuous health or an unmodeled saturation mechanism."],
  followUp: "Cite each supported link from constrained DB execution to waiting work, connection wait and caller outcomes. Explain the busier app after relief and name any tempting causal links the report cannot prove.", check: null,
};
