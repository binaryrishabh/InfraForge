import type { LearningLesson } from "@infraforge/contracts/learning";

export const queueOwnershipAndAcknowledgement: LearningLesson = {
  "id": "queue-ownership-and-acknowledgement",
  "contentVersion": 1,
  "trackId": "async",
  "moduleId": "queued-work",
  "title": "Queue acceptance is not acknowledgement",
  "summary": "Separate producer acceptance, waiting work, consumer effects and acknowledgement.",
  "kind": "reading",
  "level": "intermediate",
  "availability": "available",
  "prerequisites": [
    "client-and-server"
  ],
  "experiment": null,
  "problem": [
    "A producer has handed a job to a queue and replied to its caller. Has the background job finished?"
  ],
  "explanation": [
    "A queue decouples accepting work from executing it. The producer can hand off a message while a consumer processes it later. Waiting room absorbs some timing differences; it does not execute the jobs or remove a sustained capacity shortfall.",
    "Delivery gives a consumer an opportunity to process a message. In an acknowledgement-based queue, acknowledgement tells the queue that a delivery has been handled. Acceptance by the queue, a completed effect and acknowledgement are separate stages.",
    "A visibility lease can temporarily hide a delivered message. If the consumer does not acknowledge in time, it may become eligible for another delivery. An effect could already have happened, so another delivery can repeat that effect unless the application handles duplicates."
  ],
  "check": {
    "question": "What does a producer's successful handoff alone establish here?",
    "choices": [
      {
        "id": "accepted",
        "text": "The queue accepted the message for later processing."
      },
      {
        "id": "effect",
        "text": "The consumer completed its effect."
      },
      {
        "id": "ack",
        "text": "The consumer acknowledged the delivery."
      }
    ],
    "correctChoiceId": "accepted",
    "explanation": "Acceptance precedes consumer processing. Neither a completed effect nor a valid acknowledgement follows from producer success alone."
  },
  "limitations": [
    "These are conceptual stages, not proof of physical durability or exactly-once effects. The linked labs model logical queue ownership and result writes, not business transactions."
  ],
  "followUp": "Draw acceptance, delivery, effect and acknowledgement. Mark where another delivery could repeat an effect."
};

