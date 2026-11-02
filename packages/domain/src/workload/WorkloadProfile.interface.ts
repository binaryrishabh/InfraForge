export interface WorkloadProfile {
  targetThroughput: number;
  throughputUnit: "per-minute" | "per-hour";
  trafficShape: "steady" | "peak";
  peakMultiplier?: number;
  readWriteRatio?: number;
  payloadSize: "light" | "medium" | "heavy";
  workloadDynamics?: WorkloadDynamics;
  clientRetry?: ClientRetry;
  workloadObjective?: WorkloadObjective;
}

export interface WorkloadObjective { version: 1; maxResponseMs: number; targetSuccessPercent: number }

// Total attempts include the original. Writes are never retried.
export interface ClientRetry { version: 1; maxAttempts: number; backoffMs: number }

export interface WorkloadDynamics {
  version: 1;
  arrivalProcess: "even" | "poisson";
  // Educational parameter bounded to [0, 1]; 1 gives exponential application service time.
  applicationCpuCv: number;
}
