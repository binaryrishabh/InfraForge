import { notificationRetryStormV2 } from "./lessons/notification-retry-storm-v2";
import type { LearningModule } from "@infraforge/contracts/learning";
import { notificationRetryStorm as originalNotificationRetryStorm } from "./lessons/notification-retry-storm";
import { notificationRetryStormV3 as notificationRetryStorm } from "./lessons/notification-retry-storm-v3";
import { analyticsBurstBuffer } from "./lessons/analytics-burst-buffer";

import { analyticsBurstBufferV2 } from "./lessons/analytics-burst-buffer-v2";

export const backgroundServiceLessons = [notificationRetryStorm, analyticsBurstBufferV2];
export const backgroundServiceArchivedLessons = [notificationRetryStormV2, analyticsBurstBuffer, originalNotificationRetryStorm];
export const backgroundServices: LearningModule & {availability: "available"} = {
  id: "background-services", title: "Background services", availability: "available",
  summary: "Test a notification worker and an analytics intake with fixed educational assumptions, and see what each mission leaves unverified.",
  lessonIds: backgroundServiceLessons.map(lesson => lesson.id),
};
