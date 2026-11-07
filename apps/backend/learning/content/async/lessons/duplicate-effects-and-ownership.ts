import type { LearningLesson } from "@infraforge/contracts/learning";

export const duplicateEffectsAndOwnership: LearningLesson = {
  id: "duplicate-effects-and-ownership", contentVersion: 1, trackId: "async", moduleId: "async-reasoning",
  title: "An effect can outlive its delivery receipt", kind: "conceptual-exercise", level: "advanced", availability: "available",
  summary: "Locate the gap between a downstream effect and acknowledgement, and bound what a longer lease establishes.",
  prerequisites: ["leave-time-to-acknowledge", "parallelism-and-shared-capacity"], experiment: null,
  problem: ["A consumer writes a result, then its receipt expires before acknowledgement. Another delivery arrives. Which action is safe to assume has already happened?"],
  explanation: [
    "Revisit Finish the effect, then acknowledge (leave-time-to-acknowledge). Its requirement details separate Queue: originals, Queue: deliveries, Queue: completed object effects, Queue: acknowledged and Queue: redeliveries. Compare those populations before and after changing visibility; producer success alone does not describe the consumer's ownership.",
    "A lost or expired acknowledgement does not undo an earlier effect. At-least-once delivery therefore asks downstream code to tolerate repetition. In a thought experiment with a receipt lost after a write, neither repeating an unprotected action nor skipping every uncertain action establishes correct business behavior.",
    "A stable operation identity and an atomic check with the intended effect are possible application design requirements, not guarantees supplied by a queue lease. A separate 'done' marker leaves a gap if the effect succeeds before the marker is stored. A marker written first leaves a gap if the effect never happens.",
    "The linked lab counts successful modeled Object Storage writes, including repeated effects with idempotent writes disabled. A longer lease addresses that lab's timing mismatch. It does not prove a transaction spanning a queue and an external service."
  ],
  check: {question: "In the stated thought experiment, a result write succeeded but its receipt expired. What can another delivery establish by itself?",
    choices: [{id: "undo", text: "The earlier result was undone."}, {id: "repeat", text: "The job can be offered again even though its effect already happened."}, {id: "once", text: "A longer lease makes every external action occur exactly once."}],
    correctChoiceId: "repeat", explanation: "Delivery ownership and downstream effects are separate. Receipt expiry permits another offer; it neither rolls back the write nor supplies an atomic business transaction."},
  limitations: ["Conceptual only for operation identity, atomic deduplication and business correctness; the linked report demonstrates repeated modeled object effects, not payments, stock guarantees or distributed transactions.",
    "No physical persistence or universal delivery guarantee follows from these fixed-horizon counters. Missing effect or acknowledgement measurements remain Unknown."],
  followUp: "Return to leave-time-to-acknowledge. Explain why more maximum deliveries cannot repair an expired receipt and why fewer repeated writes still would not prove business correctness.",
};
