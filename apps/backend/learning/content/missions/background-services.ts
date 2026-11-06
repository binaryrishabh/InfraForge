import type { LearningModule } from "@infraforge/contracts/learning";
import { notificationRetryStorm } from "./lessons/notification-retry-storm";
import { analyticsBurstBuffer } from "./lessons/analytics-burst-buffer";

export const backgroundServiceLessons = [notificationRetryStorm, analyticsBurstBuffer];
export const backgroundServices: LearningModule & {availability: "available"} = {
  id: "background-services", title: "Background services", availability: "available",
  summary: "Test a notification worker and an analytics intake with fixed educational assumptions, and see what each mission leaves unverified.",
  lessonIds: backgroundServiceLessons.map(lesson => lesson.id),
};
