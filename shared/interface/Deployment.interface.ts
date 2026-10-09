import type { ChaosEvents } from "./ChaosEvents.interface";
import type { DeploymentStages } from "./DeploymentStages.interface";
import type { DeploymentStatus } from "../enum/DeploymentStatus.enum";
import type { DeploymentTimeline } from "./DeploymentTimeline.interface";
import type { WorkloadProfile } from "@infraforge/domain/workload";
import type { RunInputs, RunTopology } from "./RunInputs.interface";

export interface Deployment {
  id: string,
  infrastructureId: string,
  status: DeploymentStatus,
  resourceCount: number,
  stages: DeploymentStages[],
  timeline: DeploymentTimeline[],
  chaosEvents: ChaosEvents[],
  workloadProfile?: WorkloadProfile,
  seed?: string,
  runInputs: RunInputs | null,
  liveTopology: RunTopology | null,
  topologyRevision: number,
  createdAt: string,
  updatedAt: string
}
