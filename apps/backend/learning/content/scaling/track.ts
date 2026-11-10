import type { LearningTrack } from "@infraforge/contracts/learning";
import { servingUnderLoad } from "./serving-under-load";
import { firstScalingChoices } from "./first-scaling-choices";
import { scalingReasoning } from "./scaling-reasoning";
import { startupReadiness } from "./startup-readiness";

import { edgeAdmission } from "./edge-admission";
import { artifactAdmission } from "./artifact-admission";

export const track: LearningTrack = {
  id: "scaling", availability: "available", title: "Scaling and performance",
  summary: "Find headroom, compare response-time tails and account for repeated work.", modules: [firstScalingChoices, servingUnderLoad, scalingReasoning, startupReadiness, artifactAdmission, edgeAdmission],
};
