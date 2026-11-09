import type { LearningLesson } from "@infraforge/contracts/learning";
import { promotingAReplica } from "./promoting-a-replica";

export const promotingAReplicaV2: LearningLesson = {
  ...promotingAReplica,
  contentVersion: 2,
  explanation: [
    ...promotingAReplica.explanation.slice(0, 3),
    "In freeform Model 2 runs, the database failure controls expose these interventions. Most challenge scripts are fixed. Restore a database writer (restore-a-database-writer) accepts a saved promotion plan within its authored window through Promote at simulated second. This conceptual exercise has no scored experiment of its own.",
  ],
  limitations: [
    "Conceptual only: no challenge attempt or measured outcome is attached to this lesson. The linked recovery lab permits a promotion choice within its approved window; it does not expose arbitrary scenario editing.",
    ...promotingAReplica.limitations.slice(1),
  ],
};
