import type { LearningModule } from "@infraforge/contracts/learning";
import { keepWaitingWorkV2 as keepWaitingWork } from "./lessons/keep-waiting-work-v2";
import { whyWorkWaits } from "./lessons/why-work-waits";
import { countWaitingJobs } from "./lessons/count-waiting-jobs";

export const firstQueueLessons = [whyWorkWaits, countWaitingJobs, keepWaitingWork];
export const firstQueue: LearningModule = {
  id: "first-queue", availability: "available", title: "A first queue",
  summary: "Follow accepted work while it waits for a worker.", lessonIds: firstQueueLessons.map(lesson => lesson.id),
};
