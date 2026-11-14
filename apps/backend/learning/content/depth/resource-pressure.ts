import type { LearningModule } from "@infraforge/contracts/learning";
import { protectOneApiRouteV2 as protectOneApiRoute } from "./lessons/protect-one-api-route-v2";
import { queueOverlappingJobsV2 as queueOverlappingJobs } from "./lessons/queue-overlapping-jobs-v2";
import { boundFunctionPoolPressure } from "./lessons/bound-function-pool-pressure";

export const resourcePressureLessons = [protectOneApiRoute, queueOverlappingJobs, boundFunctionPoolPressure];
export const resourcePressure: LearningModule = {
  id: "resource-pressure", title: "Admission, overlap and downstream pressure", availability: "available",
  summary: "Compare resource policies with real caller, job and downstream measurements, including their tradeoffs.",
  lessonIds: resourcePressureLessons.map(l => l.id),
};
