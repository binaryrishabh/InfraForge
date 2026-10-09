export enum Publish {
  publishChaosInjected = "chaos-injected",
  publishOutboxFailed = "outbox-BullMQ-push-failed",
  publishDeploymentStarted = "deployment-started",
  publishStageCompleted = "stage-of-deployment-completed",
  publishDeploymentCompleted = "deployment-completed",
  publishDeploymentFailed = "deployment-failed",
  publishDeploymentLive = "deployment-live",
  publishSimulationSnapshot = "simulation-snapshot",
  publishDeploymentTornDown = "deployment-torn-down"
}

export type PublishType = (typeof Publish)[keyof typeof Publish];