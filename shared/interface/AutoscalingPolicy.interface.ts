export interface AutoscalingPolicy {
  enabled?: boolean;
  minReplicas?: number;
  maxReplicas?: number;
  targetCpu?: number;
}