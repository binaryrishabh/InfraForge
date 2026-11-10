import type { LearningModule } from "@infraforge/contracts/learning";
import { keepAFunctionWarm } from "./lessons/keep-a-function-warm";
export const functionRetentionLessons = [keepAFunctionWarm];
export const functionRetention: LearningModule = {id: "function-retention", title: "Retain a warm function", availability: "available",
  summary: "Explain cold initialization under sparse calls using saved reuse and expiry evidence.", lessonIds: functionRetentionLessons.map(l => l.id)};
