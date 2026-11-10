import type { LearningModule } from "@infraforge/contracts/learning";
import { scaleOnDeliveredSamples } from "./lessons/scale-on-delivered-samples";
export const lessons = [scaleOnDeliveredSamples];
export const monitoringControl: LearningModule = {id: "monitoring-control", title: "Let measurements drive scaling", availability: "available",
  summary: "Follow delivered measurements into an autoscaling decision.", lessonIds: lessons.map(l => l.id)};
