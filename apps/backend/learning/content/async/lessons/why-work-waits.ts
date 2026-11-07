import type { LearningLesson } from "@infraforge/contracts/learning";

export const whyWorkWaits: LearningLesson = {
  id: "why-work-waits", contentVersion: 1, trackId: "async", moduleId: "first-queue",
  title: "Why work waits in a queue", kind: "reading", level: "beginner", availability: "available",
  summary: "Separate accepting a job from doing it, and reason about arrivals that outpace a worker.",
  prerequisites: ["request-journey"], experiment: null,
  problem: ["An upload app says accepted, but the thumbnail is not ready. Where can that unfinished work wait?"],
  explanation: [
    "A producer creates a job. A queue holds its message until a worker can take it. The app can reply after handing over the message while the worker finishes the job later. Accepted and finished answer different questions.",
    "Imagine four jobs arriving each second and a worker finishing two. While those rates continue, unfinished work grows by about two jobs each second. This is what it means for the worker to be slower than arrivals. A short burst can leave waiting work even after arrivals slow down.",
    "A larger queue gives work more waiting room. It does not make the worker faster. Looking only at the app's quick replies can hide a growing delay. Work may also disappear because its lifetime ran out; an empty queue alone cannot tell you that everything finished.",
    "At-least-once delivery means a message may be delivered again. A worker could finish an action and lose its acknowledgement before the queue learns it finished. Another delivery could repeat that action. Applications need a way to handle duplicates when repeated actions would matter."
  ],
  check: null,
  limitations: ["The rates above are a thought experiment, not simulated results. This reading runs no experiment and promises no physical durability or delivery guarantee.",
    "The simulator can model repeated deliveries and result-object writes in later labs. That does not demonstrate at-least-once delivery for a real service, exactly-once actions or safe business transactions."],
  followUp: "Next open Count the waiting jobs (count-waiting-jobs) to reason about a burst and a repeated delivery before running a queue lab.",
};
