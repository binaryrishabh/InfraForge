import type { DeploymentChaosNamesType } from "@infraforge/domain/resource";

export interface ChaosEffect {
  chaosType: DeploymentChaosNamesType;
  resourceId: string;
  durationTicks: number;   // total lifetime in simulated seconds
  remainingTicks: number;  // counts down each tick
}