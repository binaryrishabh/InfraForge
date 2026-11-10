import type { LearningModule } from "@infraforge/contracts/learning";
import { cacheHitsAndMisses } from "./lessons/cache-hits-and-misses";
import { connectionPoolBudgetsV2 as connectionPoolBudgets } from "./lessons/connection-pool-budgets-v2";
import { replicaReadsAndWriterWork } from "./lessons/replica-reads-and-writer-work";
import { moveReadsOffTheWriter } from "./lessons/move-reads-off-the-writer";
import { budgetAppDatabaseSessions } from "./lessons/budget-app-database-sessions";
import { replicasDoNotTakeWrites } from "./lessons/replicas-do-not-take-writes";

export const databasePressureLessons = [cacheHitsAndMisses, connectionPoolBudgets, replicaReadsAndWriterWork,
  moveReadsOffTheWriter, budgetAppDatabaseSessions, replicasDoNotTakeWrites];
export const databasePressure: LearningModule = {
  id: "database-pressure", availability: "available", title: "Follow database work and sessions",
  summary: "Route reads, budget per-instance pools and test the limits of a replica-only fix.",
  lessonIds: databasePressureLessons.map(lesson => lesson.id),
};
