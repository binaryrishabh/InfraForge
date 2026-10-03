import type { Resource } from "@infraforge/domain/resource";
import type { ConnectionLine } from "@infraforge/domain/resource";

export interface Infrastructure {
  id: string;
  userId: string;
  name: string;
  layout: {
    resources: Resource[],
    connectionLines: ConnectionLine[]
  };
  createdAt: string;
  updatedAt: string;
}