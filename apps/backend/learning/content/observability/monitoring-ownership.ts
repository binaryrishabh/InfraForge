import type { LearningModule } from "@infraforge/contracts/learning";
import { monitoringLossAndFreshnessV2 } from "./lessons/monitoring-loss-and-freshness-v2";
import { whatIsMonitoring } from "./lessons/what-is-monitoring";
import { missingReadingsAreUnknown } from "./lessons/missing-readings-are-unknown";

export const lessons = [whatIsMonitoring, missingReadingsAreUnknown, monitoringLossAndFreshnessV2];
export const monitoringOwnership: LearningModule = {id: "monitoring-ownership", title: "Monitoring ownership", availability: "available",
  summary: "Reason about sample loss and freshness across collector and backend boundaries.", lessonIds: lessons.map(l => l.id)};

import { monitoringLossAndFreshness } from "./lessons/monitoring-loss-and-freshness";
export const archivedLessons = [monitoringLossAndFreshness];
