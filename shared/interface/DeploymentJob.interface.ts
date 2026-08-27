import { Resource } from "./Resource.interface";

export interface DeploymentJob {
  deploymentId: string;
  resources: Resource[];
}