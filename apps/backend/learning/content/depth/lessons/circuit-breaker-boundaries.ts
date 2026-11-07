import type { LearningLesson } from "@infraforge/contracts/learning";

export const circuitBreakerBoundaries: LearningLesson = {
  id: "circuit-breaker-boundaries", contentVersion: 1, trackId: "depth", moduleId: "failure-controls",
  title: "A circuit breaker stops selected attempts", kind: "conceptual-exercise", level: "advanced", availability: "available",
  summary: "Separate refusing a dependency call from repairing that dependency.",
  prerequisites: ["mitigation-tradeoffs"], experiment: null,
  problem: ["A dependency repeatedly times out. A caller opens its circuit. Has the dependency recovered, or has the caller stopped sending selected work?"],
  explanation: ["A closed circuit admits calls and counts selected failures. Opening it refuses further calls on that path during a cooldown. Half-open admission allows a bounded probe; its outcome determines whether ordinary calls resume.",
    "The Model 2 caller breaker counts connect timeouts, response timeouts, resets and backend rejection. It uses consecutive failures and a reserved half-open probe. It does not treat every local refusal as a dependency failure.",
    "Opening can protect a dependency from repeated work while making callers fail promptly. A lower latency among completions cannot establish the circuit's state or the number of calls it refused."],
  check: {question: "Which observation distinguishes an open circuit from an idle dependency?", choices: [
    {id: "idle", text: "Only low dependency CPU."}, {id: "state", text: "Path-bound circuit state, transitions and refusal counts."}],
    correctChoiceId: "state", explanation: "Low CPU has several causes. Circuit state and its own refusals identify the admission decision."},
  limitations: ["Conceptual only: the engine has breaker state and trace counters, but saved reports and the audited lesson measurement vocabulary omit them. No circuit-state lab is scored here.",
    "This bounded caller policy establishes no production availability, adaptive failure window or distributed circuit coordination."],
  followUp: "Name a caller cost of opening a circuit and the missing saved measurements needed to test it.",
};
