import type { AutoscalingSignal } from "./AutoscalingSignal.interface";

export interface AutoscalingPolicy {
  enabled?: boolean;
  minReplicas?: number;
  maxReplicas?: number;
  targetCpu?: number;
  signal?: AutoscalingSignal;
}
