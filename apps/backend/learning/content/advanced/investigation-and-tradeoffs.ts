import type { LearningModule } from "@infraforge/contracts/learning";
import { diagnoseLostAppCapacity } from "./lessons/diagnose-lost-app-capacity";
import { investigateAPoolReset } from "./lessons/investigate-a-pool-reset";
import { budgetForAPartition } from "./lessons/budget-for-a-partition";
import { traceASaturationCascade } from "./lessons/trace-a-saturation-cascade";

import { traceASaturationCascadeV2 } from "./lessons/trace-a-saturation-cascade-v2";
export const archivedLessons = [traceASaturationCascade];

export const investigationAndTradeoffsLessons = [diagnoseLostAppCapacity, investigateAPoolReset, budgetForAPartition, traceASaturationCascadeV2];
export const investigationAndTradeoffs: LearningModule = {
  id: "investigation-and-tradeoffs", title: "Diagnosis, incidents and architecture choices", availability: "available",
  summary: "Explain misleading symptoms, preserve incident evidence gaps and defend capacity choices under real modeled pressure.",
  lessonIds: investigationAndTradeoffsLessons.map(l => l.id),
};
