import type { LearningLesson } from "@infraforge/contracts/learning";

export const poolIsolationBoundaries: LearningLesson = {
  id: "pool-isolation-boundaries", contentVersion: 1, trackId: "depth", moduleId: "failure-controls",
  title: "A pool limit is not a reserved share", kind: "conceptual-exercise", level: "advanced", availability: "available",
  summary: "Distinguish bounded admission from independent capacity for different callers.",
  prerequisites: ["connection-pool-budgets"], experiment: null,
  problem: ["Slow background work and urgent reads share a downstream pool. Does limiting total concurrency reserve any capacity for urgent reads?"],
  explanation: ["A pool limits the work it admits. If different classes share its slots and pending queue, either class can occupy the same capacity. A total limit can bound damage without providing a reserved share.",
    "A bulkhead assigns separate capacity or admission budgets to classes or dependencies. To test isolation, offer competing work and observe each class separately while only its assigned budget changes.",
    "The canvas adapter owns database pools per source replica and database path. Adding replicas can add pools and session demand. Independent gateway route tokens also share gateway execution capacity; they do not reserve backend workers."],
  check: {question: "What would establish a bulkhead rather than only a total limit?", choices: [
    {id: "total", text: "A lower total number of active calls."},
    {id: "separate", text: "Separate assigned budgets and per-class outcomes under competing load."}],
    correctChoiceId: "separate", explanation: "A bounded shared pool can still be occupied by the competing class."},
  limitations: ["Conceptual only for bulkheads: no saved per-class pool assignment or reservation control exists in this adapter. Existing pool and function labs demonstrate shared limits, not isolation.",
    "Separate logical pools would still share database CPU, session limits and other downstream resources."],
  followUp: "Draw the shared resources that would remain even after separating the caller pools.",
};
