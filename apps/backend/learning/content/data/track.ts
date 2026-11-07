import type { LearningTrack } from "@infraforge/contracts/learning";
import { databasePressure } from "./database-pressure";
import { cacheLifetime } from "./cache-lifetime";

export const track: LearningTrack = {
  id: "data", availability: "available", title: "Databases and caching",
  summary: "Follow read and write execution, budget database sessions and inspect delayed replica reads.", modules: [databasePressure, cacheLifetime],
};
