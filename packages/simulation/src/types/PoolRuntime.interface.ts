export interface PoolRuntime {
  lbId: string;
  baseVmIds: string[];
  minReplicas: number;
  maxReplicas: number;
  targetCpu: number;
  hotTicks: number;
  coldTicks: number;
  spawnCounter: number;
  spawnOrigin: { x: number; y: number };
  pending: { action: "up" | "down"; ticksRemaining: number } | null;
}