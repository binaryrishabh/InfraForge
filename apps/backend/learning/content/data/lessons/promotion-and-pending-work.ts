import type { LearningLesson } from "@infraforge/contracts/learning";

export const promotionAndPendingWork: LearningLesson = {
  id: "promotion-and-pending-work", contentVersion: 1, trackId: "data", moduleId: "writer-failure",
  title: "An empty backlog is not proof", summary: "Ask why pending replication disappeared before claiming that commits survived promotion.",
  kind: "conceptual-exercise", level: "intermediate", availability: "available",
  prerequisites: ["promoting-a-replica"], experiment: null,
  problem: ["After promotion, a database has no pending replication and the new writer accepts writes. Must all earlier primary commits have reached that writer?"],
  explanation: ["A pending-work counter describes work still waiting under its current rules. It does not explain every departure. Work might have been applied, cancelled or discarded. To establish preservation, follow the earlier committed changes to the promoted copy.",
    "Model 2 uses a fixed replication delay. Promoting its only replica clears the old pending work and records those unapplied operations as lost. New commits belong to the promoted writer; the model does not create another replica for them. An empty pending counter can therefore coexist with missing earlier changes.",
    "Saved database reports can retain Promoted writer commits and Pending replication. A positive commit count establishes new writer activity; a pending count describes the retained backlog. Neither count alone establishes preservation. Missing historical measurements remain Unknown.",
    "Check the promotion action, retained loss and version information, and the earlier commit population before drawing a narrower conclusion. A final snapshot cannot reconstruct an absent pre-promotion history or establish application consistency."],
  check: {question: "What can an empty pending-replication count alone establish after promotion?", choices: [
    {id: "safe", text: "Every earlier acknowledged write is preserved."},
    {id: "empty", text: "No work remains in that pending population; its departure needs separate evidence."},
    {id: "fresh", text: "Every client read sees the latest application state."}],
    correctChoiceId: "empty", explanation: "A population reaching zero does not identify whether its work was applied or discarded. New writer commits describe another population."},
  limitations: ["Conceptual only: this lesson supplies no experiment, measured loss total or scored data-preservation check.",
    "Only one replica and a fixed replication delay are represented here. Post-promotion pending replication is not a new replica's catch-up backlog.",
    "These counters do not prove zero data loss, read-after-write consistency, continuous availability, automatic failover or DNS/client reconnect behavior."],
  followUp: "Describe two different reasons a backlog can reach zero and the extra evidence needed to distinguish them.",
};
