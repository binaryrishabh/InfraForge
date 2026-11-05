import type { LearningTrack } from "@infraforge/contracts/learning";
import { queuedWork } from "./queued-work";

export const track: LearningTrack = {
  id: "async", availability: "available", title: "Asynchronous systems",
  summary: "Separate publishing from completed work, size acknowledgement leases and inspect fan-out failures.", modules: [queuedWork],
};
