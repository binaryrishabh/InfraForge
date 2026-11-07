import type { LearningModule } from "@infraforge/contracts/learning";
import { splitTheCapacityBudget } from "./lessons/split-the-capacity-budget";
import { splitTheCapacityBudgetV2 } from "./lessons/split-the-capacity-budget-v2";
import { splitTheCapacityBudgetV3 } from "./lessons/split-the-capacity-budget-v3";
import { splitTheCapacityBudgetV4 } from "./lessons/split-the-capacity-budget-v4";

export const capacityBudgetsLessons = [splitTheCapacityBudgetV4];
export const capacityBudgetsArchivedLessons = [splitTheCapacityBudget, splitTheCapacityBudgetV2, splitTheCapacityBudgetV3];
export const capacityBudgets: LearningModule = {
  id: "capacity-budgets", title: "Allocate a finite budget", availability: "available",
  summary: "Meet performance requirements across coupled tiers and decide where extra catalog spending is useful.",
  lessonIds: capacityBudgetsLessons.map(l => l.id),
};
