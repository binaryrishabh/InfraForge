import { DEFAULT_WORKLOAD_PROFILE } from "./DEFAULT_WORKLOAD_PROFILE.constants";
import type { WorkloadProfile } from "./WorkloadProfile.interface";

export const WORKLOAD_DEFAULTS = { peakMultiplier: 3, readWriteRatio: 0.8 } as const;
export type ResolvedWorkloadProfile = Required<WorkloadProfile>;

export function resolveWorkload(profile: WorkloadProfile = DEFAULT_WORKLOAD_PROFILE): ResolvedWorkloadProfile {
  return {
    ...profile,
    peakMultiplier: profile.peakMultiplier ?? WORKLOAD_DEFAULTS.peakMultiplier,
    readWriteRatio: profile.readWriteRatio ?? WORKLOAD_DEFAULTS.readWriteRatio,
  };
}
