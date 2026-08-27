import type { ChaosEvents } from "./ChaosEvents.interface";
import type { DeploymentStages } from "./DeploymentStages.interface";
import type { DeploymentStatus } from "../enum/DeploymentStatus.enum";
import type { DeploymentTimeline } from "./DeploymentTimeline.interface";
import type { WorkloadProfile } from "./WorkloadProfile.interface";

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
  createdAt: string,
  updatedAt: string
}