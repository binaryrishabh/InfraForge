import type { LearningLesson } from "@infraforge/contracts/learning";

export const fanOutSubscribers: LearningLesson = {
  "id": "fan-out-subscribers",
  "contentVersion": 1,
  "trackId": "async",
  "moduleId": "queued-work",
  "title": "Fan-out creates separate delivery paths",
  "summary": "Reason about several subscribers without confusing fan-out with competing workers.",
  "kind": "conceptual-exercise",
  "level": "intermediate",
  "availability": "available",
  "prerequisites": [
    "queue-ownership-and-acknowledgement"
  ],
  "experiment": null,
  "problem": [
    "An upload event should reach an audit queue and an image-processing queue. Does one subscriber's acknowledgement finish the other's work?"
  ],
  "explanation": [
    "Fan-out sends an event along several subscription paths. Each subscriber has its own delivery state and may perform different work. One branch can progress while another waits or refuses delivery.",
    "This differs from competing consumers on one queue, where workers share that queue's work. Sending a copy to each subscription and assigning one delivery among workers answer different requirements.",
    "Follow each stage separately: bus dispatch, queue acceptance, consumer effect and queue acknowledgement. A bus dispatch failure and a consumer failure happen at different stages; a total across branches can hide the one that needs attention."
  ],
  "check": {
    "question": "Which observation establishes that both subscriber jobs were handled?",
    "choices": [
      {
        "id": "producer",
        "text": "Only the producer's successful response."
      },
      {
        "id": "one",
        "text": "Only the audit queue's acknowledgement."
      },
      {
        "id": "each",
        "text": "Separate progress observations for each subscriber's relevant stages."
      }
    ],
    "correctChoiceId": "each",
    "explanation": "One branch's progress cannot stand in for another's. Each subscription needs its own delivery and processing accounting."
  },
  "limitations": [
    "This exercise describes logical fan-out. It establishes no ordering, physical isolation, durability or exactly-once guarantee between subscribers."
  ],
  "followUp": "Name the two independent paths and explain which stage you would inspect if just one queue receives no events."
};
