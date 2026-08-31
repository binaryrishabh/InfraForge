import type { DeploymentStagesNamesType } from "../constants/DEPLOYMENT_STAGES_NAMES.constants";
import type { DeploymentTimelineEventNamesType } from "../enum/DeploymentTimelineEventNames.enum";

export interface DeploymentTimeline {
  timestamp: string;
  event: DeploymentStagesNamesType| DeploymentTimelineEventNamesType;
  message: string;
}