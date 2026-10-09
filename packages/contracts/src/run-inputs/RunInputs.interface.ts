import type { Resource, ConnectionLine } from "@infraforge/domain/resource";
import type { ResolvedWorkloadProfile } from "@infraforge/domain/workload";

export interface RunTopology {
  resources: Resource[];
  connectionLines: ConnectionLine[];
}

export interface RunInputs extends RunTopology {
  version: 1;
  workloadProfile: ResolvedWorkloadProfile;
  seed: string;
}
