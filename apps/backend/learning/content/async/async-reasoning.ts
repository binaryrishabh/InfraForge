import type { LearningModule } from "@infraforge/contracts/learning";
import { parallelismAndSharedCapacity } from "./lessons/parallelism-and-shared-capacity";
import { duplicateEffectsAndOwnership } from "./lessons/duplicate-effects-and-ownership";

export const asyncReasoningLessons = [parallelismAndSharedCapacity, duplicateEffectsAndOwnership];
export const asyncReasoning: LearningModule = {
  id: "async-reasoning", availability: "available", title: "Reason across queue stages",
  summary: "Connect execution capacity, ownership and downstream effects without assuming unmeasured guarantees.",
  lessonIds: asyncReasoningLessons.map(lesson => lesson.id),
};
