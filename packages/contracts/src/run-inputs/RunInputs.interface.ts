import type { Resource, ConnectionLine } from "@infraforge/domain/resource";
import type { ResolvedWorkloadProfile } from "@infraforge/domain/workload";

export interface RunTopology {
  resources: Resource[];
  connectionLines: ConnectionLine[];
}

export interface RunInputsV1 extends RunTopology {
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
