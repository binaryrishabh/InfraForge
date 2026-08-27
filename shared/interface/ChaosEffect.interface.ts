import type { DeploymentChaosNamesType } from "../enum/DeploymentChaosNames.enum";

export interface ChaosEffect {
  chaosType: DeploymentChaosNamesType;
  resourceId: string;
  durationTicks: number;   // total lifetime in simulated seconds
  remainingTicks: number;  // counts down each tick
}