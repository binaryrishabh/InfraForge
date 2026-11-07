import type { LearningModule } from "@infraforge/contracts/learning";
import { parallelJobsForABurst } from "./lessons/parallel-jobs-for-a-burst";

export const burstWorkerLessons = [parallelJobsForABurst];
export const burstWorkers: LearningModule = {
  id: "burst-workers", availability: "available", title: "Workers under a burst",
  summary: "Use spare execution capacity and distinguish ready age from all unfinished work.",
  lessonIds: burstWorkerLessons.map(lesson => lesson.id),
};
