import type { ModuleDefinition } from "@infraforge/contracts/learning";
import { routeAroundASlowVm } from "./lessons/route-around-a-slow-vm";
import { leaveRoomForABurst } from "./lessons/leave-room-for-a-burst";
import { retryingAFullPool } from "./lessons/retrying-a-full-pool";

export const servingUnderLoadLessons = [routeAroundASlowVm, leaveRoomForABurst, retryingAFullPool];
export const servingUnderLoad: ModuleDefinition = {
  id: "serving-under-load", title: "Serving under load",
  summary: "Compare routing, burst capacity and retry amplification with controlled runs.",
  lessonIds: servingUnderLoadLessons.map(lesson => lesson.id),
};
