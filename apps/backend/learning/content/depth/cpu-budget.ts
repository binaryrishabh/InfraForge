import type { LearningModule } from "@infraforge/contracts/learning";
import { releaseTheCpuBudget } from "./lessons/release-the-cpu-budget";
export const cpuBudgetLessons = [releaseTheCpuBudget];
export const cpuBudget: LearningModule = {id: "cpu-budget", title: "CPU time and worker slots", availability: "available",
  summary: "Separate application CPU-time budgets from request concurrency using saved caller outcomes.", lessonIds: cpuBudgetLessons.map(l => l.id)};
