import type { LearningLesson } from "@infraforge/contracts/learning";

export const replicaReadsAndWriterWork: LearningLesson = {
  "id": "replica-reads-and-writer-work",
  "contentVersion": 1,
  "trackId": "data",
  "moduleId": "database-pressure",
  "title": "Read replicas still need a writer",
  "summary": "Separate serving reads, committing writes and applying replicated changes.",
  "kind": "conceptual-exercise",
  "level": "intermediate",
  "availability": "available",
  "prerequisites": [
    "database-read-and-write"
  ],
  "experiment": null,
  "problem": [
    "A database has one writer and one read replica. Does adding that replica split application writes between the two?"
  ],
  "explanation": [
    "A read asks for existing data. A write changes data and must be accepted by the system's write path. In a single-writer design, application writes still execute on the writer even if reads can be routed elsewhere.",
    "A read replica keeps a copy by applying changes from the writer. Serving reads there can separate some read work from writer work. Applying copied changes is different from independently accepting application writes.",
    "Asynchronous replication can leave the copy behind the writer. A read immediately after a write may need a freshness guarantee that this route alone cannot supply. An idle replica also cannot relieve a workload made entirely of application writes."
  ],
  "check": {
    "question": "What does adding a read replica directly provide in this design?",
    "choices": [
      {
        "id": "writes",
        "text": "A second destination for half the application's writes."
      },
      {
        "id": "fresh",
        "text": "A guarantee that every read sees the latest write."
      },
      {
        "id": "reads",
        "text": "Another place to serve supported reads, subject to replication lag."
      }
    ],
    "correctChoiceId": "reads",
    "explanation": "Reads can move to the copy. Application writes remain on the writer, and an asynchronous copy can be behind."
  },
  "limitations": [
    "This lesson describes a single-writer, asynchronous-copy design. It proves no freshness, failover or multi-writer behavior, and supplies no measured capacity gain."
  ],
  "followUp": "Explain why a write-only bottleneck and a stale-read problem need different investigations."
};
