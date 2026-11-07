import type { LearningLesson } from "@infraforge/contracts/learning";

export const countWaitingJobs: LearningLesson = {
  id: "count-waiting-jobs", contentVersion: 1, trackId: "async", moduleId: "first-queue",
  title: "Count the waiting jobs", kind: "conceptual-exercise", level: "beginner", availability: "available",
  summary: "Predict what extra waiting room changes and why another delivery may repeat an action.",
  prerequisites: ["why-work-waits"], experiment: null,
  problem: ["Start with no unfinished jobs. For ten seconds, four jobs arrive each second and a worker finishes two. Assume no losses. You double the queue's room but keep that worker. Has the capacity gap gone away?"],
  explanation: [
    "Forty jobs arrive and twenty finish in this thought experiment, leaving twenty unfinished. More room can hold them, but the same worker still finishes only two each second. If four keep arriving, the waiting work keeps growing. The queue hides the gap from a quick producer response; it does not fix the gap.",
    "If arrivals later fall below two each second, the worker can begin catching up. Holding messages long enough then matters: a message that expires while waiting is different from a job the worker finished.",
    "Now imagine one job's result was written but its acknowledgement never reached the queue. With at-least-once delivery another worker attempt may repeat that job. Another attempt is not a new original job, and counting attempts as unique finished work would be misleading."
  ],
  check: {question: "Which conclusion follows from these assumptions?", choices: [
    {id: "faster", text: "Twice the waiting room makes the worker finish four jobs each second."},
    {id: "gap", text: "Twenty jobs remain unfinished; a repeated delivery could repeat an action."},
    {id: "once", text: "The producer's accepted reply proves each action happened exactly once."}
  ], correctChoiceId: "gap", explanation: "Waiting room changes neither the worker's rate nor acknowledgement uncertainty. Forty arrivals minus twenty completions leaves twenty unfinished jobs under the stated no-loss assumptions."},
  limitations: ["Conceptual only: the arithmetic and lost acknowledgement are hypothetical, not recorded simulator evidence. No real queue's delivery, retention or duplicate-handling guarantee is established.",
    "Later labs model logical messages and object effects. They do not demonstrate payments, exactly-once business actions or physical persistence."],
  followUp: "Next open Let waiting work stay (keep-waiting-work). Run its starter and inspect acknowledgements and expirations to distinguish work finishing from work disappearing.",
};
