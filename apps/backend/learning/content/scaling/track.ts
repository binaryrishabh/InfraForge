import type { TrackDefinition } from "@infraforge/contracts/learning";
import { servingUnderLoad } from "./serving-under-load";

export const track: TrackDefinition = {
  id: "scaling", title: "Scaling and performance",
  summary: "Find headroom, compare response-time tails and account for repeated work.", modules: [servingUnderLoad],
};
