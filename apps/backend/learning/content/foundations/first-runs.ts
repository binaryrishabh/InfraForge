import type { LearningModule } from "@infraforge/contracts/learning";
import { whereDoesTheTimeGo } from "./lessons/where-does-the-time-go";
import { waitingWithSpareCpu } from "./lessons/waiting-with-spare-cpu";
import { oneBiggerOrTwoSmaller } from "./lessons/one-bigger-or-two-smaller";
import { writesCostMoreThanReads } from "./lessons/writes-cost-more-than-reads";
import { balancerSharesTurns } from "./lessons/balancer-shares-turns";

export const firstRunsLessons = [whereDoesTheTimeGo, waitingWithSpareCpu, oneBiggerOrTwoSmaller, writesCostMoreThanReads, balancerSharesTurns];
export const firstRuns: LearningModule = {
  id: "first-runs", availability: "available", title: "Your first runs", summary: "Predict, run, inspect, change one thing, and compare real measurements.",
  lessonIds: firstRunsLessons.map(lesson => lesson.id),
};
