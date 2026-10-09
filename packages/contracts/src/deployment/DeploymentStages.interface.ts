import { DeploymentStageStatus } from "./DeploymentStageStatus.enum";
import type { DeploymentStagesNamesType } from "./DEPLOYMENT_STAGES_NAMES.constants";

export interface DeploymentStages {
  name: DeploymentStagesNamesType;
  status: DeploymentStageStatus;
  startedAt: string;
  completedAt: string;
  message: string;
  details?: Record<string, any>;
}