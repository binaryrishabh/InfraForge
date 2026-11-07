import type { LearningLesson } from "@infraforge/contracts/learning";

export const retryOwnershipAcrossLayers: LearningLesson = {
  id: "retry-ownership-across-layers", contentVersion: 1, trackId: "failures", moduleId: "failure-reasoning",
  title: "Budget retries across call boundaries", kind: "reading", level: "advanced", availability: "available",
  summary: "Trace who owns repeated work before treating a local attempt limit as an end-to-end budget.",
  prerequisites: ["choose-a-retry-mitigation", "retry-limits-and-budgets"], experiment: null,
  problem: ["An outer caller retries a whole operation while an inner caller also retries its dependency. Does either local limit alone describe the dependency's total work?"],
  explanation: [
    "Revisit Choose a mitigation and name its cost (choose-a-retry-mitigation). Compare Admitted by backend (attempts), Queued at VM (attempts), p95, Whole run: Completed and Whole run: Failed under the same partition. Attempt admissions count repeated work; original caller outcomes answer a different question.",
    "For a thought experiment, allow an outer call at most three attempts, including its first. Each outer attempt creates a fresh inner call allowing at most two dependency attempts, including its first. If every attempt runs, the dependency can receive six attempts for one original operation. This is a bound under stated assumptions, not a measurement from the lab.",
    "An end-to-end design must assign retry ownership, carry the remaining deadline across calls and decide which failures may be retried safely. Local backoff changes timing, but fresh inner budgets can still multiply repetition. A shared concurrent retry budget limits overlapping ownership; it is distinct from a total attempt bound.",
    "The partition lab isolates one load-balancer attempt limit. Its caller counts must accompany its terminal completed-request p95. Neither those counts nor backend admissions identify a cross-layer deadline policy or the reason a shared retry budget suppressed work."
  ],
  check: {question: "Under the thought experiment's assumptions, what is the maximum dependency attempt count for one original operation?",
    choices: [{id: "three", text: "Three: the outer limit alone."}, {id: "five", text: "Five: add the two limits."}, {id: "six", text: "Six: each of three outer attempts can start two inner attempts."}],
    correctChoiceId: "six", explanation: "Every outer attempt creates a fresh inner budget, so the bounds multiply when all attempts run. Cancellation, a shared deadline or earlier success can reduce that count."},
  limitations: ["Conceptual only for layered retry multiplication and propagated deadline ownership; no linked lab demonstrates that composed policy. Saved LB accounting does not identify concurrent-budget suppression reasons.",
    "The lab's p95 concerns terminal-second completions, not a whole-run SLO. Retry admissions do not prove safe repeated writes, continuous recovery or production availability."],
  followUp: "Reopen choose-a-retry-mitigation. State its caller cost, then draw the hypothetical outer and inner owners and identify which composed-budget observation is missing.",
};
