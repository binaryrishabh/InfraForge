import type { LearningLesson } from "@infraforge/contracts/learning";

export const leaveTimeToAcknowledge: LearningLesson = {
  id: "leave-time-to-acknowledge", contentVersion: 1, trackId: "async", moduleId: "queued-work",
  title: "Finish the effect, then acknowledge", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Compare originals, delivery attempts and repeated object effects when an acknowledgement outlives its lease.",
  prerequisites: ["keep-up-with-the-queue", "queue-ownership-and-acknowledgement"],
  problem: ["The result can be written before the message is acknowledged. A one-second lease expires during the worker's two-second acknowledgement delay."],
  explanation: ["Run the starter. Read the saved requirement detail through second 15. Count originals, deliveries, completed object effects, acknowledgements, redeliveries and dead letters separately.",
    "Select queue. Change only Visibility timeout from one to five seconds. Keep the 250 CPU milliseconds per job, 2000 millisecond acknowledgement delay, delivery limit and prefetch credit unchanged. Run again.",
    "Explain which population shrank and which grew. As a near miss, restore one-second visibility and raise only maximum deliveries to five; more attempts cannot make an expired receipt valid."],
  experiment: {challengeId: "leave-time-to-acknowledge", prediction: "Can three originals cause more than three completed object effects while acknowledgements remain zero?",
    evidenceToInspect: ["Queue: originals; Queue: deliveries; Queue: completed object effects", "Queue: acknowledged; Queue: ready; Queue: in flight; Queue: scheduled", "Queue: redeliveries; Queue: dead-lettered; Completed requests/s"]},
  limitations: ["Results are educational model outputs. A completed effect means a successful modeled Object Storage result write. Rewriting the same logical key is another effect, not another original message or a financial transaction.",
    "Acknowledgement delay starts after processing and the result write. Prefetch credit remains occupied; a larger lease can delay reassignment after a failure.",
    "Idempotent result writes are disabled. Longer visibility does not provide exactly-once execution, physical durability or cross-resource transaction guarantees. These timings are educational inputs."],
  followUp: "Use both reports to explain why effects are separate from acknowledgements and why extra delivery attempts cannot repair a lease that is too short.",
  check: {question: "Which event releases the broker's ownership in this model?",
    choices: [{id: "effect", text: "The result object is written"}, {id: "ack", text: "A valid delivery receipt is acknowledged"}],
    correctChoiceId: "ack", explanation: "The result write precedes acknowledgement. An expired delivery receipt cannot acknowledge the current message ownership."},
};
