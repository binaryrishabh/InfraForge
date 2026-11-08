import type { LearningModule } from "@infraforge/contracts/learning";
import { replaceWithinTheByteBudget } from "./lessons/replace-within-the-byte-budget";

export const objectOwnershipLessons = [replaceWithinTheByteBudget];
export const objectOwnership: LearningModule = {
  id: "object-ownership", title: "Object replacement and byte ownership", availability: "available",
  summary: "Separate current object bytes, committed replacements and refused writes from delivery ownership.",
  lessonIds: objectOwnershipLessons.map(lesson => lesson.id),
};
