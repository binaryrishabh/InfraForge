import type { LearningModule } from "@infraforge/contracts/learning";
import { monitoringLossAndFreshness } from "./lessons/monitoring-loss-and-freshness";

export const lessons = [monitoringLossAndFreshness];
export const monitoringOwnership: LearningModule = {id: "monitoring-ownership", title: "Monitoring ownership", availability: "available",
  summary: "Reason about sample loss and freshness across collector and backend boundaries.", lessonIds: lessons.map(l => l.id)};
