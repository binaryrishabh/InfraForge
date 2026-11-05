import type { LearningTrack } from "@infraforge/contracts/learning";
import { servingUnderLoad } from "./serving-under-load";

export const track: LearningTrack = {
  id: "scaling", availability: "available", title: "Scaling and performance",
  summary: "Find headroom, compare response-time tails and account for repeated work.", modules: [servingUnderLoad],
};
