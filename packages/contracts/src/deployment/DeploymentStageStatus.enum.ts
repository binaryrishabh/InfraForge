export enum DeploymentStageStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed"
}

export type DeploymentStageStatusType = (typeof DeploymentStageStatus)[keyof typeof DeploymentStageStatus];