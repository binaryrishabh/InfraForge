import type { LearningModule } from "@infraforge/contracts/learning";
import { checkTheMissingServer } from "./lessons/check-the-missing-server";

export const firstFailureLessons = [checkTheMissingServer];
export const firstFailure: LearningModule = {
  id: "first-failure", availability: "available", title: "A first failure",
  summary: "Observe a missing server and change how soon routing notices.", lessonIds: firstFailureLessons.map(lesson => lesson.id),
};
