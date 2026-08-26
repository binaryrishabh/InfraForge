import type { ChaosEvents } from "./ChaosEvents.types";
import type { DeploymentStages } from "./DeploymentStages.types";
import type { DeploymentStatus } from "../enum/DeploymentStatus.enum";
import type { DeploymentTimeline } from "./DeploymentTimeline.types";
import type { WorkloadProfile } from "./WorkloadProfile.types";

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