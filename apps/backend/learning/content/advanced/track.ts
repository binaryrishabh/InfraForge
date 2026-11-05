import type { LearningTrack } from "@infraforge/contracts/learning";
import { investigationAndTradeoffs } from "./investigation-and-tradeoffs";

export const track: LearningTrack = {
  id: "advanced", title: "Advanced practice", availability: "available",
  summary: "Diagnose, investigate and defend architectural tradeoffs with retained engine evidence and explicit limits.",
  modules: [investigationAndTradeoffs],
};
