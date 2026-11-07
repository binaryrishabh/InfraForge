import type { LearningLesson } from "@infraforge/contracts/learning";

export const backpressureBoundaries: LearningLesson = {
  id: "backpressure-boundaries", contentVersion: 1, trackId: "depth", moduleId: "failure-controls",
  title: "Waiting room and upstream pressure", kind: "conceptual-exercise", level: "intermediate", availability: "available",
  summary: "Separate bounded queue ownership and consumer credit from an upstream demand response.",
  prerequisites: ["queue-ownership-and-acknowledgement"], experiment: null,
  problem: ["A worker falls behind and the queue fills. Does increasing queue capacity make the producer slow its offered traffic?"],
  explanation: ["A queue can own waiting work until a capacity or retention boundary. Consumer credit bounds unacknowledged deliveries to that consumer. Neither setting makes the work itself cheaper to execute.",
    "Backpressure needs a signal and an upstream response. A consumer can stop accepting work; the producer must then wait, reduce demand or otherwise handle refusal. A larger queue can postpone this boundary while retaining more outstanding work.",
    "This engine's bounded broker can refuse publishing, and prefetch credit limits worker ownership. The authored open-loop workload keeps offering arrivals; it does not become an adaptive producer when the queue fills."],
  check: {question: "Which observation would distinguish adaptive upstream backpressure from more buffering?", choices: [
    {id: "room", text: "Only a larger queue capacity."},
    {id: "feedback", text: "A retained pressure signal followed by a measured change in upstream offered demand."}],
    correctChoiceId: "feedback", explanation: "Waiting room is capacity. Adaptive demand requires a separate feedback behavior."},
  limitations: ["Conceptual only for upstream feedback: existing queue labs measure acknowledgements, ready work and capacity, not adaptive producer pacing. The engine has no such workload feedback controller or audited feedback measurement.",
    "Logical queue ownership establishes no physical durability or exactly-once business effect."],
  followUp: "Describe what a producer should do on refusal and what you would measure to verify that behavior.",
};
