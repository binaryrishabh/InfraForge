export { track } from "./track";
import { admissionDiagnosisLessons } from "./admission-diagnosis";
import { memoryAdmissionLessons } from "./memory-admission";
import { asyncAndDependenciesLessons } from "./async-and-dependencies";
import { reportFirstLessons } from "./report-first";
export const lessons = [...admissionDiagnosisLessons, ...memoryAdmissionLessons, ...asyncAndDependenciesLessons, ...reportFirstLessons];
import { memoryAdmissionArchivedLessons } from "./memory-admission";
import { asyncAndDependenciesArchivedLessons } from "./async-and-dependencies";
export const archivedLessons = [...memoryAdmissionArchivedLessons, ...asyncAndDependenciesArchivedLessons];
