import { DeploymentStageStatus } from "../enum/DeploymentStageStatus.enum";
import type { DeploymentStagesNamesType } from "../constants/DEPLOYMENT_STAGES_NAMES.constants";

export interface DeploymentStages {
  name: DeploymentStagesNamesType;
  status: DeploymentStageStatus;
  startedAt: string;
  completedAt: string;
  message: string;
  details?: Record<string, any>;
}