import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";

export function isRetiredDeployment(status: string): boolean {
  return status === DeploymentStatus.COMPLETED || status === DeploymentStatus.FAILED || status === DeploymentStatus.TORN_DOWN;
}

export function deploymentFailureStatus(attemptsMade: number, attempts = 1): DeploymentStatus {
  return attemptsMade + 1 >= attempts ? DeploymentStatus.FAILED : DeploymentStatus.RUNNING;
}
