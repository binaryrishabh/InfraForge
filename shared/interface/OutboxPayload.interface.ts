import { Resource } from "./Resource.interface";
import { ConnectionLine } from "./ConnectionLine.interface";

export interface OutboxPayload {
    deploymentId: string;
    infrastructureId?: string;
    resources?: Resource[];
    connectionLines?: ConnectionLine[];
    chaosType?: string;
    resourceId?: string;
    message?: string;
}