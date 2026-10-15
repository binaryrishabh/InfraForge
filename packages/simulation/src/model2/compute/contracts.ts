import type { Quantity } from "../../reality/quantity";
import type { DemandProfile } from "../workload/profiles";
import type { WorkStation, WorkloadInput, StationState } from "../workload/contracts";

export interface ComputeProfile extends Omit<DemandProfile, "schema" | "io" | "stage"> {
  schema: "infraforge-compute-demand/1";
  stage: "compute";
  blockingWait: Quantity<"us">;
  maxCpuParallelism: Quantity<"cores">;
  residentCoverage: "complete-model" | "partial";
  requestResidentBytes?: Quantity<"bytes">;
  activeResidentBytes?: Quantity<"bytes">;
  residentComponents?: Array<{ id: string; owner: "admitted" | "active"; bytes: Quantity<"bytes"> }>;
}
export interface ComputeResource extends Omit<WorkStation, "kind" | "concurrency"> {
  kind: "compute";
  workers: Quantity<"count">;
  scheduler: "capped-equal-fluid/1";
  quota?: { budget: Quantity<"cpu-us">; period: Quantity<"us"> };
  memory: { coverage: "complete-model" | "partial"; baseline?: Quantity<"bytes">; perWorker?: Quantity<"bytes">; retained?: Quantity<"bytes">;
    components?: Array<{ id: string; owner: "process" | "worker"; bytes: Quantity<"bytes"> }>;
    limit?: Quantity<"bytes">; policy: "observe" | "reject-allocation" };
}
export type ComputeIntervention = { id: string; target: string; at: Quantity<"us"> } & (
  { kind: "capacity"; cores: Quantity<"cores"> } |
  { kind: "competitor"; duration: Quantity<"us">; demand: Quantity<"cpu-us">; parallelism: Quantity<"cores"> });
export interface ComputeInput extends Omit<WorkloadInput, "workloadVersion" | "profiles" | "resources"> {
  workloadVersion: "m2c/1";
  profiles: Array<ComputeProfile | DemandProfile>;
  resources: Array<ComputeResource | (WorkStation & { kind: "database" }) | { id: string; kind: "router"; backends: string[] }>;
  interventions: ComputeIntervention[];
}
export interface ComputeState extends StationState {
  compute?: {
    workers: { configured: number; idle: number; runnable: number; blockedWait: number; blockedDependency: number };
    cpu: { capacity: number; runnable: number; receivingShare: number; contended: boolean; paused: boolean; throttled: boolean;
      appCoreUs: number; competitorCoreUs: number; availableCoreUs: number; throttledWallUs: number; unsatisfiedParallelismUs: number;
      quotaRemainingCoreUs: number | null; allocations: Array<{ id: string; cores: number; remainingCoreUs: number }> };
    memory: { ownership: { requests: number; active: number }; knownSubtotalBytes: number; totalResidentBytes: Quantity<"bytes">; components: Record<string, Quantity<"bytes"> >; limitBytes: number | null; comparison: "unknown" | "within" | "exceeds"; policy: string };
    symptoms: string[];
    allocationRejected: number;
  };
}
