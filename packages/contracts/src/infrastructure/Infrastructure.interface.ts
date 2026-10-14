import type { Resource } from "@infraforge/domain/resource";
import type { ConnectionLine } from "@infraforge/domain/resource";

export interface Infrastructure {
  id: string;
  userId: string;
  name: string;
  challengeId?: string | null;
  // A challenge workspace belongs to one version of its challenge.
  challengeVersion?: number | null;
  layout: {
    resources: Resource[],
    connectionLines: ConnectionLine[],
    layoutVersion?: number
  };
  createdAt: string;
  updatedAt: string;
}
