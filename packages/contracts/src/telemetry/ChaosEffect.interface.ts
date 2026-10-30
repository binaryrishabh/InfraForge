import type { DeploymentChaosNamesType } from "@infraforge/domain/resource";

export interface ChaosEffect {
  chaosType?: DeploymentChaosNamesType;
  intervention?: { actionId: string; label: string; parameters: Record<string, number | boolean | string>; restoreAtUs: number; edgeIds?: string[] };
  resourceId: string;
  durationTicks: number;   // total lifetime in simulated seconds
  remainingTicks: number;  // counts down each tick
}