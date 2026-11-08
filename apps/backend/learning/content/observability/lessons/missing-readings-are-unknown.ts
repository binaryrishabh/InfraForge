import type { LearningLesson } from "@infraforge/contracts/learning";

export const missingReadingsAreUnknown: LearningLesson = {
  id: "missing-readings-are-unknown", contentVersion: 1, trackId: "observability", moduleId: "monitoring-ownership",
  title: "Read a missing measurement", kind: "conceptual-exercise", level: "beginner", availability: "available",
  summary: "Choose what a missing backend age can support without turning it into zero or a health verdict.",
  prerequisites: [], experiment: null,
  problem: ["Imagine a saved monitoring snapshot where Collection freshness state says fresh but the backend Measurement age is Unknown. Can you conclude that the backend has a new measurement or that the application failed?"],
  explanation: [
    "A collector gathers measurements from a target resource and sends samples to a backend, the receiving program. A measurement describes an observation of that resource, not everything about its health. Monitoring: Collection freshness state follows the latest successful collection. It does not establish that the sample reached the backend.",
    "Monitoring backend: Measurement age describes the age of the newest measurement that arrived for a target. Unknown means that age is unavailable in the saved snapshot. A recorded zero would be a value; Unknown is missing information. Missing data alone cannot tell you whether collection, delivery or the saved evidence is responsible, and cannot establish application failure.",
    "Before drawing a conclusion, keep the collector resource, backend Identity, backend Target and snapshot together. Inspect collection failures, confirmed exports and backend received samples separately if present. Backend received samples include duplicate arrivals. These readings help you ask where an observation is missing; a fresh label alone cannot prove that every sample arrived."
  ],
  check: {question: "In this imagined snapshot, collection is fresh and backend Measurement age is Unknown. What can you conclude?",
    choices: [{id: "zero", text: "The backend age is zero, so it has a new measurement."},
      {id: "failed", text: "The missing backend age proves that the application failed."},
      {id: "unknown", text: "The backend age is unavailable; fresh collection alone proves neither delivery nor application health."}],
    correctChoiceId: "unknown", explanation: "Unknown is not a measured zero or a failure verdict. Collection freshness describes successful collection, while backend age needs a saved arrived measurement. Keep both observations separate before investigating delivery."},
  limitations: ["This is an imagined reasoning exercise, not an executed run, a scored monitoring lab or a server assessment of mastery.",
    "The snapshot does not identify why evidence is missing. Freshness cannot establish a complete history, continuous health or recovery time; backend age has no authored health threshold."],
  followUp: "Next, open Separate monitoring loss from freshness (monitoring-loss-and-freshness) to distinguish samples held locally, acknowledged exports and backend arrivals. Suggested lessons are advice; you can open any lesson directly.",
};
