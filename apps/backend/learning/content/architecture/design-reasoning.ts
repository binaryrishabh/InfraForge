import type { LearningModule } from "@infraforge/contracts/learning";
import { compareDesignsHonestly } from "./lessons/compare-designs-honestly";
import { passingDesignsAndBudget } from "./lessons/passing-designs-and-budget";

export const designReasoningLessons = [compareDesignsHonestly, passingDesignsAndBudget];
export const designReasoning: LearningModule = {
  id: "design-reasoning", title: "Reason about design choices", availability: "available",
  summary: "State constraints, test a focused change and defend a passing design's concessions.",
  lessonIds: designReasoningLessons.map(l => l.id),
};
