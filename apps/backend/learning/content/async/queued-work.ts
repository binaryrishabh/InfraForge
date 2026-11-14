import type { LearningModule } from "@infraforge/contracts/learning";
import { queueOwnershipAndAcknowledgement } from "./lessons/queue-ownership-and-acknowledgement";
import { fanOutSubscribers } from "./lessons/fan-out-subscribers";
import { keepUpWithTheQueue } from "./lessons/keep-up-with-the-queue";
import { leaveTimeToAcknowledgeV2 as leaveTimeToAcknowledge } from "./lessons/leave-time-to-acknowledge-v2";
import { openOneSubscriber } from "./lessons/open-one-subscriber";

export const queuedWorkLessons = [queueOwnershipAndAcknowledgement, fanOutSubscribers,
  keepUpWithTheQueue, leaveTimeToAcknowledge, openOneSubscriber];
export const queuedWork: LearningModule = {
  id: "queued-work", availability: "available", title: "Follow queued work to completion",
  summary: "Inspect consumer capacity, acknowledgement leases and independent subscriber delivery.",
  lessonIds: queuedWorkLessons.map(lesson => lesson.id),
};
