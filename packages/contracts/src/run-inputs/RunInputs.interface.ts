import type { Resource, ConnectionLine } from "@infraforge/domain/resource";
import type { ResolvedWorkloadProfile } from "@infraforge/domain/workload";

export interface RunTopology {
  resources: Resource[];
  connectionLines: ConnectionLine[];
}

export type AdapterProfile = "failure-cause/1";

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
