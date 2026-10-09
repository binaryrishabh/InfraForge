import type { Resource } from "@infraforge/domain/resource";
import type { ConnectionLine } from "@infraforge/domain/resource";

export interface OutboxPayload {
    deploymentId: string;
    infrastructureId?: string;
    resources?: Resource[];
    connectionLines?: ConnectionLine[];
    chaosType?: string;
    resourceId?: string;
    message?: string;
}
