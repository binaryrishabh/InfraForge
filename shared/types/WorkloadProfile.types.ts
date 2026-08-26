export interface WorkloadProfile {
  targetThroughput: number;
  throughputUnit: "per-minute" | "per-hour";
  trafficShape: "steady" | "peak";
  peakMultiplier?: number;
  readWriteRatio?: number;
  payloadSize: "light" | "medium" | "heavy";
}