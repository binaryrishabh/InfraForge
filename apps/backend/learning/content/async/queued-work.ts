import type { ModuleDefinition } from "@infraforge/contracts/learning";
import { keepUpWithTheQueue } from "./lessons/keep-up-with-the-queue";
import { leaveTimeToAcknowledge } from "./lessons/leave-time-to-acknowledge";
import { openOneSubscriber } from "./lessons/open-one-subscriber";

export const queuedWorkLessons = [keepUpWithTheQueue, leaveTimeToAcknowledge, openOneSubscriber];
export const queuedWork: ModuleDefinition = {
  id: "queued-work", title: "Follow queued work to completion",
  summary: "Inspect consumer capacity, acknowledgement leases and independent subscriber delivery.",
  lessonIds: queuedWorkLessons.map(lesson => lesson.id),
};
