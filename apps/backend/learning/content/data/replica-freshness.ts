import type { LearningModule } from "@infraforge/contracts/learning";
import { boundReplicaStaleness } from "./lessons/bound-replica-staleness";

export const replicaFreshnessLessons = [boundReplicaStaleness];
export const replicaFreshness: LearningModule = {
  id: "replica-freshness", availability: "available", title: "Fast reads and fresh reads",
  summary: "Tell replica capacity apart from replica freshness.",
  lessonIds: replicaFreshnessLessons.map(l => l.id),
};
