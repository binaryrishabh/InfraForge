import type { LearningModule } from "@infraforge/contracts/learning";
import { moveMonitoringSamples } from "./lessons/move-monitoring-samples";
export const lessons = [moveMonitoringSamples];
export const monitoringThroughput: LearningModule = {id: "monitoring-throughput", title: "Move observations to the backend", availability: "available",
  summary: "Compare export capacity with local sample storage in a controlled run.", lessonIds: lessons.map(l => l.id)};
