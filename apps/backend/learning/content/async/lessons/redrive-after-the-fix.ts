import type { LearningLesson } from "@infraforge/contracts/learning";

export const redriveAfterTheFix: LearningLesson = {
  id: "redrive-after-the-fix", contentVersion: 1, trackId: "async", moduleId: "dead-letter-recovery",
  title: "Redrive after the fix", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Time a dead-letter redrive against the repair and see why replaying before the fix only fails again.",
  prerequisites: ["queue-ownership-and-acknowledgement", "duplicate-effects-and-ownership"],
  problem: ["A worker fails some jobs, the queue dead-letters them, and one redrive is already scheduled. Run the starter and find out why most of the saved work is still not completed."],
  explanation: ["Predict overall health, then write an ungraded note on what a redrive does. Read acknowledged, dead-lettered, redriven and redelivered counts in the queue's work readings.",
    "Select queue and change only Redrive dead-lettered messages at second from 20 to a later second than the worker's repair second. Keep the delivery limit and the worker unchanged, then compare the two saved reports and confirm one change.",
    "A redrive returns each dead-lettered message with its delivery count reset. Before the repair the cause is still present, so they fail again and are dead-lettered again; after it they succeed.",
    "Restore the starter and raise only the delivery limit as a near miss. More deliveries before dead-lettering repeat failing work and waste worker time, but messages that fail before the repair are still lost to the list."],
  experiment: {challengeId: "redrive-after-the-fix", prediction: "Will the queue finish with most messages acknowledged when the redrive is scheduled before the repair?",
    evidenceToInspect: ["Queue: acknowledged", "Queue: dead-lettered", "Queue: redriven", "Queue: redeliveries", "Queue: originals"]},
  limitations: ["Results are educational model outputs. The repair second and redrive second are authored inputs, not measured recovery times, and the bad share is an assumed input.",
    "A redrive here returns every dead-lettered message once. Ordering, selective replay, duplicate effects of replay outside the modeled result write, alerting and real queue products are not modeled.",
    "Callers and the producer path are not judged. A reading missing from the report stays Unknown."],
  followUp: "Cite the starter, the redrive that moved after the repair and the near miss that only raised the delivery limit. Explain why replay is only useful once the next delivery can succeed. Compare keep-failed-events, where the failed list itself is too small to hold the evidence.",
  check: null,
};
