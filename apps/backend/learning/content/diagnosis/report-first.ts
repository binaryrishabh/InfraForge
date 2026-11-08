import type { LearningModule } from "@infraforge/contracts/learning";
import { readBeforeChangingV2 } from "./lessons/read-before-changing-v2";

export const reportFirstLessons = [readBeforeChangingV2];
export const reportFirst: LearningModule = {
  id: "report-first", title: "Start with the report", availability: "available",
  summary: "Read caller outcomes and resource clues before changing a degraded design.",
  lessonIds: reportFirstLessons.map(l => l.id),
};

import { readBeforeChanging } from "./lessons/read-before-changing";
export const reportFirstArchivedLessons = [readBeforeChanging];
