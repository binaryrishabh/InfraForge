import type { DeploymentChaosNamesType } from "../enum/DeploymentChaosNames.enum";

export interface ChaosEvents {
  timestamp: string;
  type: DeploymentChaosNamesType;
  resourceId: string;
  message: string;
}