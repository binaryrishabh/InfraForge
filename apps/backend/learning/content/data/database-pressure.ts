import type { LearningModule } from "@infraforge/contracts/learning";
import { moveReadsOffTheWriter } from "./lessons/move-reads-off-the-writer";
import { budgetAppDatabaseSessions } from "./lessons/budget-app-database-sessions";
import { replicasDoNotTakeWrites } from "./lessons/replicas-do-not-take-writes";

export const databasePressureLessons = [moveReadsOffTheWriter, budgetAppDatabaseSessions, replicasDoNotTakeWrites];
export const databasePressure: LearningModule = {
  id: "database-pressure", availability: "available", title: "Follow database work and sessions",
  summary: "Route reads, budget per-instance pools and test the limits of a replica-only fix.",
  lessonIds: databasePressureLessons.map(lesson => lesson.id),
};
