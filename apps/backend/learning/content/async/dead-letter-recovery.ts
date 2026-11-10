import type { LearningModule } from "@infraforge/contracts/learning";
import { redriveAfterTheFix } from "./lessons/redrive-after-the-fix";
import { keepFailedEvents } from "./lessons/keep-failed-events";
export const deadLetterRecoveryLessons = [keepFailedEvents, redriveAfterTheFix];
export const deadLetterRecovery: LearningModule = {
  id: "dead-letter-recovery", availability: "available", title: "Recover dead-lettered work",
  summary: "Order a repair and a replay of dead-lettered messages.",
  lessonIds: deadLetterRecoveryLessons.map(lesson => lesson.id),
};
