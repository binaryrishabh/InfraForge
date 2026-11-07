import type { LearningModule } from "@infraforge/contracts/learning";
import { readBeforeChanging } from "./lessons/read-before-changing";

export const reportFirstLessons = [readBeforeChanging];
export const reportFirst: LearningModule = {
  id: "report-first", title: "Start with the report", availability: "available",
  summary: "Read caller outcomes and resource clues before changing a degraded design.",
  lessonIds: reportFirstLessons.map(l => l.id),
};
