import type { LearningTrack } from "@infraforge/contracts/learning";
import { applicationPools } from "./application-pools";
import { admissionDiagnosis } from "./admission-diagnosis";
import { memoryAdmission } from "./memory-admission";
import { asyncAndDependencies } from "./async-and-dependencies";
import { reportFirst } from "./report-first";
import { capstoneCascades } from "./capstone-cascades";

export const track: LearningTrack = {
  id: "diagnosis", title: "Diagnose a degraded design", availability: "available",
  summary: "Find a supported cause in an already misbehaving starter and test one change against retained evidence.",
  modules: [applicationPools, admissionDiagnosis, memoryAdmission, asyncAndDependencies, reportFirst, capstoneCascades],
};
