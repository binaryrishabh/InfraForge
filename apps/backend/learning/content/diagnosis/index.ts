export { track } from "./track";
import { admissionDiagnosisLessons } from "./admission-diagnosis";
import { memoryAdmissionLessons } from "./memory-admission";
export const lessons = [...admissionDiagnosisLessons, ...memoryAdmissionLessons];
