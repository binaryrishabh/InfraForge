import type { ResourceHealthType } from "@infraforge/domain/resource";

export interface ResourceMetrics {
  cpu: number | null;
  memory: number | null;
  connections?: number;
  rps?: number;
  health: ResourceHealthType;
}