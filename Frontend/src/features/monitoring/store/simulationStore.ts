import { create } from "zustand";
import type { ResourceMetrics } from "@shared/interface/ResourceMetrics.interface";
import type { SimulationLog } from "@shared/interface/SimulationLog.interface";
import type { SimulationSnapshot } from "@shared/interface/SimulationSnapshot.interface";
import type { PoolSnapshot } from "@shared/interface/PoolSnapshot.interface";
import type { SpawnedVmInfo } from "@shared/interface/SpawnedVmInfo.interface";

const MAX_LOGS = 150;

interface SimulationStoreState {
  metrics: Record<string, ResourceMetrics>;
  logs: SimulationLog[];
  health: SimulationSnapshot["health"] | null;
  loadFraction: number;
  simulatedSeconds: number;
  lastSnapshotAt: string | null;
  pools: Record<string, PoolSnapshot>;
  spawnedVms: SpawnedVmInfo[];
  restarting: string[];
  speed: number;
  applySnapshot: (snapshot: SimulationSnapshot) => void;
  setSpeed: (speed: number) => void;
  reset: () => void;
}

const initialState = {
  metrics: {} as Record<string, ResourceMetrics>,
  logs: [] as SimulationLog[],
  health: null as SimulationSnapshot["health"] | null,
  loadFraction: 0,
  simulatedSeconds: 0,
  lastSnapshotAt: null as string | null,
  pools: {} as Record<string, PoolSnapshot>,
  spawnedVms: [] as SpawnedVmInfo[],
  restarting: [] as string[],
  speed: 1
};

export const useSimulationStore = create<SimulationStoreState>()((set) => ({
  ...initialState,
  applySnapshot: (snapshot) => set((prev) => ({
    metrics: snapshot.metrics,
    logs: [...prev.logs, ...snapshot.logs].slice(-MAX_LOGS),
    health: snapshot.health,
    loadFraction: snapshot.loadFraction,
    simulatedSeconds: snapshot.simulatedSeconds,
    lastSnapshotAt: snapshot.timestamp,
    pools: snapshot.pools ?? {},
    spawnedVms: snapshot.spawnedVms ?? [],
    restarting: snapshot.restarting ?? [],
    speed: snapshot.speed ?? 1
  })),
  setSpeed: (speed) => set({ speed }),
  reset: () => set({ ...initialState, metrics: {}, logs: [], pools: {}, spawnedVms: [], restarting: [], speed: 1 })
}));