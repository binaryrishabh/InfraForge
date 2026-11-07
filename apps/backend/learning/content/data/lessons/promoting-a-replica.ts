import type { LearningLesson } from "@infraforge/contracts/learning";

export const promotingAReplica: LearningLesson = {
  id: "promoting-a-replica", contentVersion: 1, trackId: "data", moduleId: "writer-failure",
  title: "Choose a new writer", summary: "Separate having a replica from promoting it after a primary failure.",
  kind: "conceptual-exercise", level: "intermediate", availability: "available",
  prerequisites: ["replica-reads-and-writer-work"], experiment: null,
  problem: ["The primary stops accepting writes while its read replica remains available. Does the presence of that replica make it the writer?"],
  explanation: ["A replica can serve supported reads without accepting application writes. When the only writer becomes unavailable, a writable destination must be chosen explicitly unless a separate failover mechanism does that work.",
    "Model 2 has distinct primary-outage, replica-outage and replica-promotion interventions. Promotion changes the replica's role to writer and fences the original primary. Its later return does not move the writer role back. A replica outage instead interrupts the copy while the primary can keep accepting writes.",
    "Promotion does not finish writes that already failed. A later successful write and a lower final response time cannot erase earlier caller failures. Examine cumulative caller outcomes as well as the new writer's commits.",
    "In freeform Model 2 runs, the database failure controls expose these interventions. Challenge attempts use fixed authored scripts; this conceptual exercise has no editable promotion script or scored experiment."],
  check: {question: "What must change before the available replica can accept application writes?", choices: [
    {id: "presence", text: "Nothing; an available replica automatically becomes the writer."},
    {id: "role", text: "The replica must be promoted to the writer role."},
    {id: "capacity", text: "More read capacity alone elects a writer."}],
    correctChoiceId: "role", explanation: "Availability and writer authority are different. A read replica's presence alone does not perform promotion."},
  limitations: ["Conceptual only: no challenge attempt or measured outcome is attached to this lesson. The current challenge workspace cannot add or retime a promotion step.",
    "The model does not establish automatic failure detection, failover orchestration, DNS changes, application driver reconnect behavior or a production recovery-time guarantee.",
    "Promotion supplies no data-loss or consistency guarantee. The copy may lack earlier commits; a working new writer alone cannot establish their preservation."],
  followUp: "Explain separately how you would verify writer authority, failed callers and preservation of earlier commits.",
};
