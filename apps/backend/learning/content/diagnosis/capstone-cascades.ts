import type { LearningModule } from "@infraforge/contracts/learning";
import { traceASlowdownCascade } from "./lessons/trace-a-slowdown-cascade";
import { traceABurstBacklog } from "./lessons/trace-a-burst-backlog";
import { traceAScalingStall } from "./lessons/trace-a-scaling-stall";
export const capstoneCascadeLessons = [traceASlowdownCascade, traceABurstBacklog, traceAScalingStall];
export const capstoneCascades: LearningModule = {id: "capstone-cascades", title: "Trace a whole incident", availability: "available",
  summary: "Follow one failure through several layers and fix its source.", lessonIds: capstoneCascadeLessons.map(l => l.id)};
