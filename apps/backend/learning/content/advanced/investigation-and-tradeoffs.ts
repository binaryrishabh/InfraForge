import type { LearningModule } from "@infraforge/contracts/learning";
import { diagnoseLostAppCapacity } from "./lessons/diagnose-lost-app-capacity";
import { investigateAPoolReset } from "./lessons/investigate-a-pool-reset";
import { budgetForAPartition } from "./lessons/budget-for-a-partition";
import { traceASaturationCascade } from "./lessons/trace-a-saturation-cascade";

export const investigationAndTradeoffsLessons = [diagnoseLostAppCapacity, investigateAPoolReset, budgetForAPartition, traceASaturationCascade];
export const investigationAndTradeoffs: LearningModule = {
  id: "investigation-and-tradeoffs", title: "Diagnosis, incidents and architecture choices", availability: "available",
  summary: "Explain misleading symptoms, preserve incident evidence gaps and defend capacity choices under real modeled pressure.",
  lessonIds: investigationAndTradeoffsLessons.map(l => l.id),
};
