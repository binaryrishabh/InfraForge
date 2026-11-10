import type { LearningTrack } from "@infraforge/contracts/learning";
import { firstCdn } from "./first-cdn";
import { originLoad } from "./origin-load";

export const track: LearningTrack = {id: "delivery", title: "Content delivery", availability: "available",
  summary: "Trace cached content, origin fetches and the limits of reuse.", modules: [firstCdn, originLoad]};
