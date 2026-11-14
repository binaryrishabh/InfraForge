import { closureCorrectionArchives } from "./closure-correction-archives";
export { track } from "./track";
import { crossResourceChoicesLessons } from "./cross-resource-choices";
import { capacityBudgetsLessons } from "./capacity-budgets";
import { designReasoningLessons } from "./design-reasoning";
export const lessons = [...crossResourceChoicesLessons, ...capacityBudgetsLessons, ...designReasoningLessons];
import { capacityBudgetsArchivedLessons } from "./capacity-budgets";
import { cacheEvidenceArchivedLessons } from "./cache-evidence-archives";
export const archivedLessons = [...closureCorrectionArchives, ...capacityBudgetsArchivedLessons, ...cacheEvidenceArchivedLessons];
