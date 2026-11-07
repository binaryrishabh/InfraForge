import type { LearningModule } from "@infraforge/contracts/learning";
import { diagnoseQueryAdmission } from "./lessons/diagnose-query-admission";

export const admissionDiagnosisLessons = [diagnoseQueryAdmission];
export const admissionDiagnosis: LearningModule = {
  id: "admission-diagnosis", title: "Find the hidden admission bound", availability: "available",
  summary: "Separate database execution admission from CPU capacity, lock waiting and session exhaustion.",
  lessonIds: admissionDiagnosisLessons.map(lesson => lesson.id),
};
