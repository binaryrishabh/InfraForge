import type { LearningLesson } from "@infraforge/contracts/learning";
import { connectionPoolBudgets } from "./connection-pool-budgets";

export const connectionPoolBudgetsV2: LearningLesson = {
  ...connectionPoolBudgets,
  contentVersion: 2,
  limitations: [
    "This exercise uses stated hypothetical pool limits. Actual occupancy depends on connection creation and closing rules. In Size the app database pool (size-the-app-database-pool), Application database connections is an editable per-app, per-replica and per-database-path limit; it does not change database CPU or the database session ceiling.",
  ],
};
