export enum DeploymentStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  LIVE = "live",
  // A Model 2 run executing in the browser; the server replays it when the browser submits.
  BROWSER = "browser",
  TORN_DOWN = "torn-down"
}

export type DeploymentStatusType = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];