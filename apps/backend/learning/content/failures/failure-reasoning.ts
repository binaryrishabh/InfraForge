import type { LearningModule } from "@infraforge/contracts/learning";
import { retryOwnershipAcrossLayers } from "./lessons/retry-ownership-across-layers";
import { healthChecksAndFailureScope } from "./lessons/health-checks-and-failure-scope";

export const failureReasoningLessons = [retryOwnershipAcrossLayers, healthChecksAndFailureScope];
export const failureReasoning: LearningModule = {
  id: "failure-reasoning", availability: "available", title: "Match controls to failure boundaries",
  summary: "Trace retry ownership and probe scope before extending a lab's conclusion.",
  lessonIds: failureReasoningLessons.map(lesson => lesson.id),
};
