import { create } from "zustand";
import type { ResourceMetrics } from "@shared/interface/ResourceMetrics.interface";
import type { SimulationLog } from "@shared/interface/SimulationLog.interface";
import type { SimulationSnapshot } from "@shared/interface/SimulationSnapshot.interface";
import type { PoolSnapshot } from "@shared/interface/PoolSnapshot.interface";
import type { SpawnedVmInfo } from "@shared/interface/SpawnedVmInfo.interface";
import type { ChaosEffect } from "@shared/interface/ChaosEffect.interface";

const MAX_LOGS = 150;
const MAX_CPU_HISTORY = 30;
const EMPTY_ACTIVE_CHAOS: ChaosEffect[] = [];

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
  burnRatePerHourUsd: number;
  accumulatedCostUsd: number;
  cpuHistory: Record<string, number[]>;
  activeChaos: ChaosEffect[];
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
  speed: 1,
  burnRatePerHourUsd: 0,
  accumulatedCostUsd: 0,
  cpuHistory: {} as Record<string, number[]>,
  activeChaos: EMPTY_ACTIVE_CHAOS,
};

export const useSimulationStore = create<SimulationStoreState>()((set) => ({
  ...initialState,
  applySnapshot: (snapshot) =>
    set((prev) => {
      const nextCpuHistory: Record<string, number[]> = { ...prev.cpuHistory };
      const metricKeys = Object.keys(snapshot.metrics);
      
      for (const resourceId of metricKeys) {
        const currentCpu = snapshot.metrics[resourceId]?.cpu ?? 0;
        const existingHistory = nextCpuHistory[resourceId] ?? [];
        const updatedHistory = [...existingHistory, currentCpu];
        
        if (updatedHistory.length > MAX_CPU_HISTORY) {
          nextCpuHistory[resourceId] = updatedHistory.slice(updatedHistory.length - MAX_CPU_HISTORY);
        } else {
          nextCpuHistory[resourceId] = updatedHistory;
        }
      }

      const incomingChaos = snapshot.activeChaos ?? EMPTY_ACTIVE_CHAOS;
      const previousChaos = prev.activeChaos;
      let chaosChanged = incomingChaos.length !== previousChaos.length;
      
      if (!chaosChanged) {
        for (let i = 0; i < incomingChaos.length; i++) {
          const next = incomingChaos[i];
          const old = previousChaos[i];
          if (!old || old.resourceId !== next.resourceId ||
              old.chaosType !== next.chaosType ||
              old.remainingTicks !== next.remainingTicks) {
            chaosChanged = true;
            break;
          }
        }
      }

      return {
        metrics: snapshot.metrics,
        logs: [...prev.logs, ...snapshot.logs].slice(-MAX_LOGS),
        health: snapshot.health,
        loadFraction: snapshot.loadFraction,
        simulatedSeconds: snapshot.simulatedSeconds,
        lastSnapshotAt: snapshot.timestamp,
        pools: snapshot.pools ?? {},
        spawnedVms: snapshot.spawnedVms ?? [],
        restarting: snapshot.restarting ?? [],
        speed: snapshot.speed ?? 1,
        burnRatePerHourUsd: snapshot.burnRatePerHourUsd ?? 0,
        accumulatedCostUsd: snapshot.accumulatedCostUsd ?? 0,
        cpuHistory: nextCpuHistory,
        activeChaos: chaosChanged ? incomingChaos : previousChaos,
      };
    }),
  setSpeed: (speed) => set({ speed }),
  reset: () =>
    set({
      ...initialState,
      metrics: {},
      logs: [],
      pools: {},
      spawnedVms: [],
      restarting: [],
      speed: 1,
      burnRatePerHourUsd: 0,
      accumulatedCostUsd: 0,
      cpuHistory: {},
      activeChaos: EMPTY_ACTIVE_CHAOS,
    }),
}));