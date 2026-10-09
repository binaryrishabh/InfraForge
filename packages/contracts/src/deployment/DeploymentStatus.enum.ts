export enum DeploymentStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  LIVE = "live",
  TORN_DOWN = "torn-down"
}

export type DeploymentStatusType = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];