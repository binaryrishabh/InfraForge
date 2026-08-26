export enum DeploymentTimelineEventNames {
  DeploymentStarted = "Deployment Started",
  DeploymentCompleted = "Deployment Completed",
  DeploymentFailed = "Deployment Failed",
  OutboxFailed = "Outbox Failed",
  ChaosInjected = "Chaos Injected",
  DeploymentLive = "Deployment Live",
  DeploymentTornDown = "Deployment Torn Down"
}

export type DeploymentTimelineEventNamesType = (typeof DeploymentTimelineEventNames)[keyof typeof DeploymentTimelineEventNames];