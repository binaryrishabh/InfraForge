import type { LearningLesson } from "@infraforge/contracts/learning";

export const keepFailedEvents: LearningLesson = {
  id: "keep-failed-events", contentVersion: 1, trackId: "async", moduleId: "dead-letter-recovery",
  title: "Keep failed events", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "See a full dead-letter list discard failed events, then keep them with one capacity change.",
  prerequisites: ["queue-ownership-and-acknowledgement"],
  problem: ["A subscriber keeps failing and the team wants every failed event kept for repair. Run the starter and find out how many are actually kept."],
  explanation: ["Predict overall health, then read the bus's dead letters, overflow discards and exhausted deliveries.",
    "Select bus and change only Dead-letter capacity. Keep delivery attempts, retry delay and the subscriber's closed listener unchanged. Compare the two saved reports and confirm one change.",
    "Each exhausted dispatch needs room in the list. When it is full the event is discarded and only the overflow counter shows it.",
    "Restore the starter and raise only Delivery attempts as a near miss. More attempts repeat failing work but the list is no bigger, so the events are still discarded."],
  experiment: {challengeId: "keep-failed-events", prediction: "Will the bus keep the failed events when its dead-letter list is small?",
    evidenceToInspect: ["Dead letters", "Dead-letter overflow discards", "Exhausted deliveries", "Retries"]},
  limitations: ["Results are educational model outputs. The capacity is an authored limit, not a provider quota.",
    "The subscriber stays broken on purpose here. Replay, ordering, alerting and durable storage of a real dead-letter list are not modeled.",
    "A reading missing from the report stays Unknown."],
  followUp: "Cite the starter, the capacity change and the near miss that only raised delivery attempts. Explain why a failure can be invisible when the list is full.",
  check: null,
};
