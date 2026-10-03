import { Resource } from "@infraforge/domain/resource";
import { ConnectionLine } from "@infraforge/domain/resource";

export interface DeploymentJob {
    deploymentId: string;
    resources: Resource[];
    connectionLines?: ConnectionLine[];
}