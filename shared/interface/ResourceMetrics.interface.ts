import type { ResourceHealthType } from "../enum/ResourceHealth.enum";

export interface ResourceMetrics {
  cpu: number;
  memory: number;
  connections?: number;
  rps?: number;
  health: ResourceHealthType;
}