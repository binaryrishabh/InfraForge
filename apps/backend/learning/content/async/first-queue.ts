import type { LearningModule } from "@infraforge/contracts/learning";
import { keepWaitingWork } from "./lessons/keep-waiting-work";

export const firstQueueLessons = [keepWaitingWork];
export const firstQueue: LearningModule = {
  id: "first-queue", availability: "available", title: "A first queue",
  summary: "Follow accepted work while it waits for a worker.", lessonIds: firstQueueLessons.map(lesson => lesson.id),
};
