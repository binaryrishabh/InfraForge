import type { LearningLesson } from "@infraforge/contracts/learning";

export const connectionPoolBudgets: LearningLesson = {
  "id": "connection-pool-budgets",
  "contentVersion": 1,
  "trackId": "data",
  "moduleId": "database-pressure",
  "title": "What a connection pool limits",
  "summary": "Distinguish per-app connection budgets from database session capacity and query work.",
  "kind": "conceptual-exercise",
  "level": "beginner",
  "availability": "available",
  "prerequisites": [
    "database-read-and-write"
  ],
  "experiment": null,
  "problem": [
    "An app instance owns a pool of up to ten database connections. If four app instances each own one pool, is ten still the total budget?"
  ],
  "explanation": [
    "A connection pool reuses connections and limits how many that owner can open. Requests may wait for a free connection, and an idle connection can remain open even when no query is running.",
    "Independent app instances can own independent pools. Four pools with a maximum of ten can collectively ask for forty connections. That is a possible budget, not proof that forty sessions are actually open.",
    "The database has its own session limit and execution capacity. Enlarging pools or adding app instances can increase demand on those limits without making queries cheaper or adding database CPU."
  ],
  "check": {
    "question": "What can four independent pools, each limited to ten, request together?",
    "choices": [
      {
        "id": "ten",
        "text": "At most ten connections across all apps."
      },
      {
        "id": "forty",
        "text": "Up to forty connections, though actual occupancy can be lower."
      },
      {
        "id": "queries",
        "text": "Exactly forty completed queries per second."
      }
    ],
    "correctChoiceId": "forty",
    "explanation": "Per-owner limits add across independent pools. They bound possible connections, not observed occupancy or query throughput."
  },
  "limitations": [
    "This exercise uses stated hypothetical pool limits. Actual occupancy depends on connection creation and closing rules; pool size is not an editable control in the current database labs."
  ],
  "followUp": "Explain why idle database CPU does not prove spare session slots."
};
