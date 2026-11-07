import type { LearningTrack } from "@infraforge/contracts/learning";
import { admissionDiagnosis } from "./admission-diagnosis";
import { memoryAdmission } from "./memory-admission";

export const track: LearningTrack = {
  id: "diagnosis", title: "Diagnose a degraded design", availability: "available",
  summary: "Find a supported cause in an already misbehaving starter and test one change against retained evidence.",
  modules: [admissionDiagnosis, memoryAdmission],
};
