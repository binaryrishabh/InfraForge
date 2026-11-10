import type { LearningModule } from "@infraforge/contracts/learning";
import { fitTheWorkingSet } from "./lessons/fit-the-working-set";

export const cacheWorkingSetLessons = [fitTheWorkingSet];
export const cacheWorkingSet: LearningModule = {
  id: "cache-working-set", availability: "available", title: "Fit the working set",
  summary: "Separate cache capacity from cache lifetime when reads keep missing.",
  lessonIds: cacheWorkingSetLessons.map(l => l.id),
};
