import type { Resource, ConnectionLine } from "@infraforge/domain/resource";
import type { ResolvedWorkloadProfile } from "@infraforge/domain/workload";

export interface RunTopology {
  resources: Resource[];
  connectionLines: ConnectionLine[];
}

export type AdapterProfile = "lb-accounting/1" | "serverless/1" | "scheduler/1" | "api-gateway/1" | "event-bus/1" | "traffic-evidence/2" | "client-retry/1" | "db-replication/1" | "db-read-routing/1" | "failure-cause/1" | "application-flow/2" | "application-flow/3" | "data-keyspace/1" | "data-hot-key/1" | "data-cache-policy/1" | "data-cache-capacity/1" | "data-db-concurrency/1" | "lb-rate-limit/1" | "lb-admission/1" | "lb-selection/1" | "lb-health/1" | "vm-execution/1" | "vm-memory/1" | "vm-cpu-quota/1" | "queue-capacity/1" | "queue-idempotency/1" | "queue-ack-delay/1" | "dns-cache/1" | "cdn-ttl/1" | "cdn-coalescing/1" | "monitor-cadence/1" | "monitor-buffer/1" | "object-capacity/1" | "firewall-flow-capacity/1";

// Missing profiles identify inputs captured before implicit adapter profiles were recorded.
export interface RunProfileSelection { adapterProfiles?: AdapterProfile[] }

export interface RunInputsV1 extends RunTopology, RunProfileSelection {
  version: 1;
  workloadProfile: ResolvedWorkloadProfile;
  seed: string;
}

export interface RunInputsV2 extends Omit<RunInputsV1, "version"> {
  version: 2;
  simulationModelVersion: string;
  catalogSnapshot: string;
}

export type RunInputs = RunInputsV1 | RunInputsV2;
