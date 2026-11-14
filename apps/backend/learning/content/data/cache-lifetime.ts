import type { LearningModule } from "@infraforge/contracts/learning";
import { reuseBeforeExpiryV4 as reuseBeforeExpiry } from "./lessons/reuse-before-expiry-v4";

export const cacheLifetimeLessons = [reuseBeforeExpiry];
export const cacheLifetime: LearningModule = {
  id: "cache-lifetime", availability: "available", title: "Give cached reads time to be reused",
  summary: "Distinguish expiry from eviction with an unchanged read-only working set.",
  lessonIds: cacheLifetimeLessons.map(lesson => lesson.id),
};
