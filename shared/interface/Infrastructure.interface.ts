import type { Resource } from "./Resource.interface";
import type { ConnectionLine } from "./ConnectionLine.interface";

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