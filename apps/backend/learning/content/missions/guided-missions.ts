import type { LearningModule } from "@infraforge/contracts/learning";
import { openAndSizeAnApi } from "./lessons/open-and-size-an-api";

export const guidedMissionLessons = [openAndSizeAnApi];
export const guidedMissions: LearningModule & {availability: "available"} = {
  id: "guided-missions", title: "Guided two-concept missions", availability: "available",
  summary: "Combine two familiar controls in a short steady run before attempting the advanced application missions.",
  lessonIds: guidedMissionLessons.map(lesson => lesson.id),
};
