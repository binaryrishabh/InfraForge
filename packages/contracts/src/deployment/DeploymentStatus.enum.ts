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

// A run is active from queueing until it is recorded, including while it runs in the learner's browser.
export const ACTIVE_RUN_STATUSES: readonly string[] = [DeploymentStatus.PENDING, DeploymentStatus.RUNNING, DeploymentStatus.LIVE, DeploymentStatus.BROWSER];
export const isActiveRunStatus = (status: string) => ACTIVE_RUN_STATUSES.includes(status);
