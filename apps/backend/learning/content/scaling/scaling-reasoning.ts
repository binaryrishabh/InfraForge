import type { LearningModule } from "@infraforge/contracts/learning";
import { initialReplicasAndLaterLimits } from "./lessons/initial-replicas-and-later-limits";

export const scalingReasoningLessons = [initialReplicasAndLaterLimits];
export const scalingReasoning: LearningModule = {
  id: "scaling-reasoning", availability: "available", title: "Reason across scaling windows",
  summary: "Distinguish initial pools, later replica limits and useful work before proposing another change.",
  lessonIds: scalingReasoningLessons.map(lesson => lesson.id),
};
