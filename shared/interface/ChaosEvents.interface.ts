import type { DeploymentChaosNamesType } from "@infraforge/domain/resource";

export interface ChaosEvents {
  timestamp: string;
  type: DeploymentChaosNamesType;
  resourceId: string;
  message: string;
}