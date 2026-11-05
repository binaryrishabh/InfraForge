import type { TrackDefinition } from "@infraforge/contracts/learning";
import { queuedWork } from "./queued-work";

export const track: TrackDefinition = {
  id: "async", title: "Asynchronous systems",
  summary: "Separate publishing from completed work, size acknowledgement leases and inspect fan-out failures.", modules: [queuedWork],
};
