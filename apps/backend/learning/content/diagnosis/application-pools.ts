import type { LearningModule } from "@infraforge/contracts/learning";
import { sizeTheAppDatabasePool } from "./lessons/size-the-app-database-pool";
export const applicationPoolLessons = [sizeTheAppDatabasePool];
export const applicationPools: LearningModule = { id: "application-pools", title: "Size application transport pools", availability: "available",
  summary: "Test a database transport pool bound while CPU has spare capacity.", lessonIds: applicationPoolLessons.map(lesson => lesson.id) };
