import type { DeploymentStagesNamesType } from "./DEPLOYMENT_STAGES_NAMES.constants";
import type { DeploymentTimelineEventNamesType } from "./DeploymentTimelineEventNames.enum";

export interface DeploymentTimeline {
  timestamp: string;
  event: DeploymentStagesNamesType| DeploymentTimelineEventNamesType;
  message: string;
}