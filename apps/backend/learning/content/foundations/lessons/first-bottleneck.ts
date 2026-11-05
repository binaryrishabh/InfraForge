import type { LearningLesson } from "@infraforge/contracts/learning";

export const lesson: LearningLesson = {
  id: "first-bottleneck", contentVersion: 1, trackId: "foundations", moduleId: "load-and-limits",
  title: "Finding the first bottleneck", summary: "Look for the constrained part of the request path before choosing a change.",
  kind: "conceptual-exercise", level: "beginner", availability: "available", prerequisites: ["more-users-more-pressure"], experiment: null,
  problem: ["A service responds slowly under load. You could add application servers, enlarge the database or change a query. How would you choose what to investigate first?"],
  explanation: [
    "A bottleneck is a constraint that limits useful work for a particular workload and design. Start by following the request path. Ask where work waits, what resource is busy and whether errors or refusals occur there. High CPU is one clue; connection limits, slow storage and other constraints can matter too.",
    "Write a hypothesis that connects a suspected limit to the symptom. For example: if database work is holding requests up, changing application capacity alone may leave that wait. Keep the workload fixed while changing one relevant design choice, then inspect measurements that could support or contradict the hypothesis.",
    "A successful change can expose a different constraint. Keep the workload and measurement interval visible when comparing observations. If the needed measurements are absent, the cause remains unknown; a plausible story is not enough to establish it.",
  ],
  check: { question: "Which next step best tests a suspected bottleneck?",
    choices: [{ id: "controlled", text: "Keep the workload fixed, change one relevant choice and inspect the affected measurements." }, { id: "many", text: "Change several machine sizes and traffic at once, then assume the cause is known." }],
    correctChoiceId: "controlled", explanation: "A controlled change helps distinguish explanations. Several simultaneous changes make it harder to connect an outcome to a cause." },
  limitations: ["This exercise proposes an investigation; it supplies no measured bottleneck or causal result. A real experiment needs recorded observations under stated conditions."],
};
