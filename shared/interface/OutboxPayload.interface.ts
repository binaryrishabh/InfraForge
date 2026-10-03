import { Resource } from "@infraforge/domain/resource";
import { ConnectionLine } from "@infraforge/domain/resource";

export interface OutboxPayload {
    deploymentId: string;
    infrastructureId?: string;
    resources?: Resource[];
    connectionLines?: ConnectionLine[];
    chaosType?: string;
    resourceId?: string;
    message?: string;
}