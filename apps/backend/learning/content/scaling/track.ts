import type { LearningTrack } from "@infraforge/contracts/learning";
import { servingUnderLoad } from "./serving-under-load";
import { firstScalingChoices } from "./first-scaling-choices";

export const track: LearningTrack = {
  id: "scaling", availability: "available", title: "Scaling and performance",
  summary: "Find headroom, compare response-time tails and account for repeated work.", modules: [firstScalingChoices, servingUnderLoad],
};
