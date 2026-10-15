import type { Quantity } from "../reality/quantity";
import type { RealityEntry } from "../reality/ledger";

export interface ServiceDemand { cpu: Quantity<"cpu-us">; io: Quantity<"us"> }
export interface StationConfig {
  id: string;
  kind: "compute" | "database";
  cores: Quantity<"cores">;
  concurrency: Quantity<"count">;
  queueCapacity: Quantity<"count">;
  demand: Record<string, ServiceDemand>;
  downstream?: string;
}
export interface RequestClass {
  id: string;
  entry: string;
  count: Quantity<"count">;
  interval: Quantity<"us">;
  start: Quantity<"us">;
  timeout: Quantity<"us">;
}
export interface RouterConfig { id: string; kind: "router"; backends: string[] }
export interface FaultPlan { id: string; target: string; kind: "pause-service"; at: Quantity<"us">; duration: Quantity<"us"> }
export interface Model2Input {
  modelVersion: "2";
  seed: string;
  ledger: RealityEntry[];
  resources: Array<StationConfig | RouterConfig>;
  workload: RequestClass[];
  faults: FaultPlan[];
  horizon: Quantity<"us">;
  sampleInterval: Quantity<"us">;
  limits: { maxEvents: number; maxSamples: number; maxRequests: number };
}
export interface Work { id: string; classId: string; arrived: number; deadline: number }
export type WorkOutcome = "completed" | "rejected" | "timed-out";
export interface StationMeasurement {
  id: string;
  status: "healthy" | "backpressured" | "unavailable";
  queued: number;
  active: number;
  waitingOnDependency: number;
  completed: number;
  rejected: number;
  cpuConsumedUs: number;
  connections: number | null;
  memoryBytes: Quantity<"bytes">;
}
// Modules accept work and compose shared mechanisms. They never mutate neighbours' metrics.
export interface ResourceBehavior<Measurements = StationMeasurement, Fault = boolean> {
  accept(work: Work, done: (outcome: WorkOutcome) => void): void;
  cancel(id: string): void;
  fault(effect: Fault): void;
  measure(): Measurements;
}
