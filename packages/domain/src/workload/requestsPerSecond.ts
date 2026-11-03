import type { WorkloadProfile } from "./WorkloadProfile.interface";

export function requestsPerSecond(w: Pick<WorkloadProfile, "targetThroughput" | "throughputUnit">) {
  return w.targetThroughput / (w.throughputUnit === "per-minute" ? 60 : 3600);
}
