import { WorkloadProfile } from "../interface/WorkloadProfile.interface";

export const DEFAULT_WORKLOAD_PROFILE: WorkloadProfile = {
  targetThroughput: 1_000_000,
  throughputUnit: "per-hour",
  trafficShape: "steady",
  payloadSize: "medium"
};

export type DefaultWorkloadProfileType = typeof DEFAULT_WORKLOAD_PROFILE;