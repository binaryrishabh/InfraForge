import type { LearningModule } from "@infraforge/contracts/learning";
import { loadBalancerPolicies } from "./lessons/load-balancer-policies";
import { percentilesAndPopulations } from "./lessons/percentiles-and-populations";
import { retriesAddWork } from "./lessons/retries-add-work";
import { routeAroundASlowVm } from "./lessons/route-around-a-slow-vm";
import { leaveRoomForABurst } from "./lessons/leave-room-for-a-burst";
import { retryingAFullPool } from "./lessons/retrying-a-full-pool";

export const servingUnderLoadLessons = [loadBalancerPolicies, percentilesAndPopulations, retriesAddWork,
  routeAroundASlowVm, leaveRoomForABurst, retryingAFullPool];
export const servingUnderLoad: LearningModule = {
  id: "serving-under-load", availability: "available", title: "Serving under load",
  summary: "Compare routing, burst capacity and retry amplification with controlled runs.",
  lessonIds: servingUnderLoadLessons.map(lesson => lesson.id),
};
