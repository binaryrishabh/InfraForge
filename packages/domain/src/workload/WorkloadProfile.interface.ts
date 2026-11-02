export interface WorkloadProfile {
  targetThroughput: number;
  throughputUnit: "per-minute" | "per-hour";
  trafficShape: "steady" | "peak";
  peakMultiplier?: number;
  readWriteRatio?: number;
  payloadSize: "light" | "medium" | "heavy";
  workloadDynamics?: WorkloadDynamics;
}

export interface WorkloadDynamics {
  version: 1;
  arrivalProcess: "even" | "poisson";
  // Educational parameter bounded to [0, 1]; 1 gives exponential application service time.
  applicationCpuCv: number;
}
