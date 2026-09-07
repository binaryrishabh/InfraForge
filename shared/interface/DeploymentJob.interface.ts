import { Resource } from "./Resource.interface";
import { ConnectionLine } from "./ConnectionLine.interface";

export interface DeploymentJob {
    deploymentId: string;
    resources: Resource[];
    connectionLines?: ConnectionLine[];
}