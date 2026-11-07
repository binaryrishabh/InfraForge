import type { LearningModule } from "@infraforge/contracts/learning";
import { diagnoseQueryAdmission } from "./lessons/diagnose-query-admission";

import { diagnoseQueryAdmissionV2 } from "./lessons/diagnose-query-admission-v2";

export const admissionDiagnosisArchivedLessons = [diagnoseQueryAdmission];
export const admissionDiagnosisLessons = [diagnoseQueryAdmissionV2];
export const admissionDiagnosis: LearningModule = {
  id: "admission-diagnosis", title: "Find the hidden admission bound", availability: "available",
  summary: "Separate database execution admission from CPU capacity, lock waiting and session exhaustion.",
  lessonIds: admissionDiagnosisLessons.map(lesson => lesson.id),
};
