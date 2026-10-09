import type { ResourceHealthType } from "@infraforge/domain/resource";

export interface ResourceMetrics {
  cpu: number;
  memory: number;
  connections?: number;
  rps?: number;
  health: ResourceHealthType;
}