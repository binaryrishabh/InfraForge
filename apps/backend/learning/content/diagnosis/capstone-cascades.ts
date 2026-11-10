import type { LearningModule } from "@infraforge/contracts/learning";
import { traceASlowdownCascade } from "./lessons/trace-a-slowdown-cascade";
export const capstoneCascadeLessons = [traceASlowdownCascade];
export const capstoneCascades: LearningModule = {id: "capstone-cascades", title: "Trace a whole incident", availability: "available",
  summary: "Follow one failure through several layers and fix its source.", lessonIds: capstoneCascadeLessons.map(l => l.id)};
