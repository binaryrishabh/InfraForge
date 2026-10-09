export interface SpawnedVmInfo {
  id: string;
  poolId: string;                 // the lbId anchoring the pool
  x: number;
  y: number;
  status: "provisioning" | "active";
  spawnedAtTick: number;
}