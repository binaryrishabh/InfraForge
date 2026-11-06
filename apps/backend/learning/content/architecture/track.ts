import type { LearningTrack } from "@infraforge/contracts/learning";
import { crossResourceChoices } from "./cross-resource-choices";

export const track: LearningTrack = {
  id: "architecture", title: "Architecture choices", availability: "available",
  summary: "Compare valid designs under stated requirements and explain their measured tradeoffs.",
  modules: [crossResourceChoices],
};
