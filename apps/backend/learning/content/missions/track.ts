import type { TrackDefinition } from "@infraforge/contracts/learning";
import { firstApplications } from "./first-applications";

export const track: TrackDefinition & {availability: "available"} = {
  id: "missions", title: "Real-application missions", availability: "available",
  summary: "Combine infrastructure ideas in runnable application scenarios and state which guarantees remain unverified.",
  modules: [firstApplications],
};
