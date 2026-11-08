import type { LearningModule } from "@infraforge/contracts/learning";
import { restoreADatabaseWriter } from "./lessons/restore-a-database-writer";
export const databaseIncidentLessons = [restoreADatabaseWriter];
export const databaseIncident: LearningModule = {id: "database-incident", availability: "available", title: "A database incident",
  summary: "Choose a promotion plan and compare retained failure and recovery evidence.", lessonIds: databaseIncidentLessons.map(lesson => lesson.id)};
