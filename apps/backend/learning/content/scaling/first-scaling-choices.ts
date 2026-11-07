import type { LearningModule } from "@infraforge/contracts/learning";
import { upOrOut } from "./lessons/up-or-out";
import { chooseTheConstrainedTier } from "./lessons/choose-the-constrained-tier";

export const firstScalingChoicesLessons = [upOrOut, chooseTheConstrainedTier];
export const firstScalingChoices: LearningModule = {
  id: "first-scaling-choices", availability: "available", title: "First scaling choices",
  summary: "Choose a bigger machine or more machines by following the constrained work.",
  lessonIds: firstScalingChoicesLessons.map(lesson => lesson.id),
};
