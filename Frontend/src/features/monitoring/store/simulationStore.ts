import { create } from "zustand";
import type { ResourceMetrics } from "@shared/types/ResourceMetrics.types";
import type { SimulationLog } from "@shared/types/SimulationLog.types";
import type { SimulationSnapshot } from "@shared/types/SimulationSnapshot.types";

const MAX_LOGS = 150;

interface SimulationStoreState {
  metrics: Record<string, ResourceMetrics>;
  logs: SimulationLog[];
  health: SimulationSnapshot["health"] | null;
  loadFraction: number;
  simulatedSeconds: number;
  lastSnapshotAt: string | null;
  applySnapshot: (snapshot: SimulationSnapshot) => void;
  reset: () => void;
}

const initialState = {
  metrics: {} as Record<string, ResourceMetrics>,
  logs: [] as SimulationLog[],
  health: null as SimulationSnapshot["health"] | null,
  loadFraction: 0,
  simulatedSeconds: 0,
  lastSnapshotAt: null as string | null
};

export const useSimulationStore = create<SimulationStoreState>()((set) => ({
  ...initialState,
  applySnapshot: (snapshot) => set((prev) => ({
    metrics: snapshot.metrics,
    logs: [...prev.logs, ...snapshot.logs].slice(-MAX_LOGS),
    health: snapshot.health,
    loadFraction: snapshot.loadFraction,
    simulatedSeconds: snapshot.simulatedSeconds,
    lastSnapshotAt: snapshot.timestamp
  })),
  reset: () => set({ ...initialState, metrics: {}, logs: [] })
}));