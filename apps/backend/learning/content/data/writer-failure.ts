import type { LearningModule } from "@infraforge/contracts/learning";
import { promotingAReplicaV2 as promotingAReplica } from "./lessons/promoting-a-replica-v2";
import { promotionAndPendingWork } from "./lessons/promotion-and-pending-work";

export const writerFailureLessons = [promotingAReplica, promotionAndPendingWork];
export const writerFailure: LearningModule = {
  id: "writer-failure", availability: "available", title: "Writer failure and promotion",
  summary: "Distinguish writer authority, replica backlog and preservation of earlier commits.",
  lessonIds: writerFailureLessons.map(lesson => lesson.id),
};
