import type { Quantity } from "../../reality/quantity";
import type { RealityEntry } from "../../reality/ledger";
import type { FaultPlan } from "../contracts";
import type { DemandProfile, ProfileContext } from "./profiles";

export interface OperationClass {
  id: string;
  entry: string;
  callerTimeout: Quantity<"us">;
  abandonAfter?: Quantity<"us">;
  onCallerStop: "detach" | "request-cancellation";
  idempotency: "read-only" | "idempotent" | "non-idempotent" | "unknown";
}
interface Source { id: string; operation: string; start: Quantity<"us"> }
export type ArrivalSource =
  | (Source & { kind: "periodic"; count: Quantity<"count">; interval: Quantity<"us"> })
  | (Source & { kind: "poisson"; count: Quantity<"count">; meanInterval: Quantity<"us"> })
  | (Source & { kind: "closed"; users: Quantity<"count">; perUser: Quantity<"count">; think: Quantity<"us"> })
  | { id: string; kind: "trace"; trace: ArrivalTrace }
  | { id: string; kind: "rate"; rate: RateArrivals };
// Arrivals generated while the run advances instead of stored: a declared rate with an optional peak window and
// load changes (each a fraction of the rate from its time on). Row for row the same as the equivalent trace.
export interface RateArrivals {
  schema: "infraforge-rate-arrivals/1"; provenance: string;
  startUs: number; endUs: number; intervalUs: number; readFraction: number; readOperation: string; writeOperation: string;
  // A peak window repeats every `everyUs` when set (for example a 20-second burst every 120 seconds).
  peak?: { startUs: number; endUs: number; multiplier: number; everyUs?: number };
  changes: Array<{ atUs: number; fraction: number }>;
}
export interface TraceRow { id: string; atUs: number; operation: string; payloadBytes?: number }
export interface ArrivalTrace {
  schema: "infraforge-arrivals/1";
  unit: "us";
  durationUs: number;
  provenance: string;
  rows: TraceRow[];
}
export interface WorkIdentity {
  rootId: string;
  attempt: number;
  callId: string;
  parentCallId?: string;
  operation: string;
}
export interface Invocation extends WorkIdentity {
  offeredAt: number; payloadBytes?: number;
  // Internal application messages are copied by transport; replies become visible on return.
  message?: { request: unknown; response?: unknown; bodyBytes?: { request?: number; response?: number } };
  sessionId?: string;
}
export type RemoteOutcome = "completed" | "rejected" | "cancelled";
export type CallerOutcome = "completed" | "rejected" | "deadline-exceeded" | "abandoned";
export interface Receipt {
  admitted: boolean;
  cancel(): "cancelled" | "unsupported" | "already-finished";
  state(): "queued" | "serving" | "waiting" | "finished";
}
export interface WorkStation {
  id: string;
  kind: "compute" | "database";
  cores: Quantity<"cores">;
  concurrency: Quantity<"count">;
  queueCapacity: Quantity<"count">;
  profiles: Record<string, string>;
  context: ProfileContext;
  cancellation: "cooperative" | "unsupported";
  downstream?: string;
}
export interface WorkRouter { id: string; kind: "router"; backends: string[] }
export interface WorkloadInput {
  modelVersion: "2";
  workloadVersion: "m2b/1";
  seed: string;
  ledger: RealityEntry[];
  profiles: DemandProfile[];
  resources: Array<WorkStation | WorkRouter>;
  operations: OperationClass[];
  arrivals: ArrivalSource[];
  faults: FaultPlan[];
  horizon: Quantity<"us">;
  sampleInterval: Quantity<"us">;
  limits: { maxEvents: number; maxSamples: number; maxRequests: number; maxRawResults: number; maxTraceRows: number; maxPendingEvents?: number; maxLiveCalls?: number; maxRetainedSamples?: number; maxSampleBytes?: number; maxRawBytes?: number; maxGroups?: number; maxTraceBytes?: number };
}
export interface StationState {
  id: string;
  paused: boolean;
  received: number;
  admitted: number;
  rejected: number;
  completed: number;
  failed: number;
  cancelled: number;
  queued: number;
  serving: number;
  waiting: number;
  consumedCoreUs: number;
  busySlotUs: number;
}
export interface CallerResult extends WorkIdentity {
  offeredAt: number;
  at: number;
  outcome: CallerOutcome;
  responseUs: number;
}
