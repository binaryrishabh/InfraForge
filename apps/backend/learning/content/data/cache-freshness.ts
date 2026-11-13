import type { LearningModule } from "@infraforge/contracts/learning";
import { refreshAfterAWrite } from "./lessons/refresh-after-a-write";

export const cacheFreshnessLessons = [refreshAfterAWrite];
export const cacheFreshness: LearningModule = {
  id: "cache-freshness", availability: "available", title: "Healthy is not fresh",
  summary: "See what a cache serves after a write, and choose between invalidating on write and a shorter lifetime.",
  lessonIds: cacheFreshnessLessons.map(l => l.id),
};
