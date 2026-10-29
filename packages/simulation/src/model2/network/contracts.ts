import type { Quantity } from "../../reality/quantity";
import type { ComputeInput, ComputeResource } from "../compute/contracts";

export interface LinkConfig {
  id: string; from: string; to: string; policy: "fifo-message/1";
  bandwidth: Quantity<"bytes/s">; propagation: Quantity<"us">; bufferBytes: Quantity<"bytes">;
}
export interface PoolConfig {
  evidenceProfile?: "postgresql-pools/2";
  mode: "serial" | "multiplexed"; reuse: boolean;
  maxConnections: Quantity<"count">; streams: Quantity<"count">; pending: Quantity<"count">;
  establish: Quantity<"us">; acquireTimeout: Quantity<"us">; connectTimeout: Quantity<"us">;
  responseTimeout: Quantity<"us">; idleTimeout?: Quantity<"us">;
  remoteCancellation: "detach" | "request-cancellation";
}
export interface PathConfig {
  id: string; source: string; target: string; request: string[]; response: string[]; pool: PoolConfig;
  bytes: Record<string, { request: Quantity<"bytes">; response: Quantity<"bytes"> }>;
}
export interface RetryPolicy {
  operations?: string[];
  maxAttempts: Quantity<"count">; backoff: Quantity<"us">; jitter: Quantity<"ratio">;
  maxConcurrentRetries: Quantity<"count">;
  retryOn: FailureReason[]; allowAmbiguousNonIdempotent: boolean;
}
export interface LoadBalancer {
  id: string; kind: "load-balancer"; backends: string[]; policy: "round-robin" | "least-outstanding";
  maxOutstanding: Quantity<"count">; maxPending: Quantity<"count">; pendingTimeout: Quantity<"us">;
  health: { interval: Quantity<"us">; timeout: Quantity<"us">; healthy: Quantity<"count">; unhealthy: Quantity<"count">;
    operation: string; initial: "eligible" | "ineligible" };
  retry?: RetryPolicy;
}
export type NetworkIntervention = { id: string; at: Quantity<"us"> } & (
  { kind: "partition"; target: string; duration: Quantity<"us"> } |
  { kind: "bandwidth"; target: string; duration: Quantity<"us">; bandwidth: Quantity<"bytes/s"> } |
  { kind: "delay"; target: string; duration: Quantity<"us">; delay: Quantity<"us"> } |
  { kind: "service-state"; target: string; duration: Quantity<"us">; alive: boolean; ready: boolean } |
  { kind: "drain"; target: string; backend: string; grace: Quantity<"us"> } |
  { kind: "reset"; target: string });
export interface NetworkInput extends Omit<ComputeInput, "workloadVersion" | "resources"> {
  workloadVersion: "m2d/1";
  resources: Array<ComputeResource | Extract<ComputeInput["resources"][number], { kind: "database" }> | LoadBalancer>;
  links: LinkConfig[]; paths: PathConfig[]; networkInterventions: NetworkIntervention[];
  endpoints: Record<string, { alive: boolean; ready: boolean }>;
}
export const RETRYABLE_FAILURES = ["acquire-timeout", "connect-timeout", "response-timeout", "reset", "drained", "pool-overflow", "link-overflow", "backend-rejected"] as const;
export type FailureReason = typeof RETRYABLE_FAILURES[number] | "session-limit";
export interface TraceEvent { at: number; kind: string; id: string; root?: string; attempt?: number; detail: string }
export type Trace = (kind: string, id: string, detail: string, root?: string, attempt?: number, poolEvidence?: boolean) => void;
export interface TransportResult { ok: boolean; reason?: FailureReason; ambiguous: boolean }
export interface ConnectionRoute { target: string; request: string[]; response: string[] }
export interface ConnectionHook {
  holdLeaseUntilRemoteTerminal?: boolean;
  open(id: string, done: (route?: ConnectionRoute, failure?: FailureReason) => void): () => boolean;
  close(id: string): void;
  returnTraffic?(id: string): boolean;
}
