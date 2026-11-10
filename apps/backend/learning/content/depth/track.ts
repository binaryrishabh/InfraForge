import { functionRetention } from "./function-retention";
import { quotaOwnership } from "./quota-ownership";
import { retryAndCircuitEvidence } from "./retry-and-circuit-evidence";
import type { LearningTrack } from "@infraforge/contracts/learning";
import { resourcePressure } from "./resource-pressure";
import { failureControls } from "./failure-controls";

export const track: LearningTrack = {
  id: "depth", title: "Resource depth", availability: "available",
  summary: "Practice intermediate resource policies and explain their measured effects on connected systems.",
  modules: [resourcePressure, failureControls, retryAndCircuitEvidence, quotaOwnership, functionRetention],
};
