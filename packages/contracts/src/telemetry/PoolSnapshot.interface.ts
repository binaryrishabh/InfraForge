export interface PoolSnapshot {
  lbId: string;
  baseVmIds: string[];
  currentReplicas: number;
  minReplicas: number;
  maxReplicas: number;
  targetCpu: number;
  pending: { action: "up" | "down"; secondsRemaining: number } | null;
}