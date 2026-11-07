import type { LearningModule } from "@infraforge/contracts/learning";
import { aReplicaMustBecomeReady } from "./lessons/a-replica-must-become-ready";

export const startupReadinessLessons = [aReplicaMustBecomeReady];
export const startupReadiness: LearningModule = {
  id: "startup-readiness", availability: "available", title: "Wait for useful capacity",
  summary: "Separate desired replicas, artifact acquisition, process startup and load-balancer eligibility.",
  lessonIds: startupReadinessLessons.map(l => l.id),
};
