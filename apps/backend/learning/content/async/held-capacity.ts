import type { LearningModule } from "@infraforge/contracts/learning";
import { holdSlotsOnASlowCall } from "./lessons/hold-slots-on-a-slow-call";

export const heldCapacityLessons = [holdSlotsOnASlowCall];
export const heldCapacity: LearningModule = {
  id: "held-capacity", availability: "available", title: "Capacity held while waiting",
  summary: "Tell idle CPU apart from idle job slots when work waits on an outside call.",
  lessonIds: heldCapacityLessons.map(l => l.id),
};
