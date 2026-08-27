import { DeploymentStagesNamesType } from "../constants/DEPLOYMENT_STAGES_NAMES.constants";
import { DeploymentTimelineEventNamesType } from "../enum/DeploymentTimelineEventNames.enum";

export interface DeploymentTimeline {
  timestamp: string;
  event: DeploymentStagesNamesType| DeploymentTimelineEventNamesType;
  message: string;
}