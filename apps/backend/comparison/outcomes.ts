import type { CompareMetric, ReportCheckpoint } from "@infraforge/contracts/reports";
import { canonical } from "./design";

export function metric(field: string, unit: string, a: number | undefined, b: number | undefined, allowed: boolean, reason?: string): CompareMetric {
  return { field, unit, earlier: a ?? null, later: b ?? null, delta: allowed && a !== undefined && b !== undefined ? b - a : null,
    ...(!allowed ? { withheldReason: reason ?? "Exact final-state evidence is required for a delta." } : {}) };
}
export function normalizedFinalState(state: ReportCheckpoint) {
  // Retain deterministic simulated facts; exclude IDs of runs/actions and all wall times/speed.
  return canonical({ simulatedSeconds: state.simulatedSeconds, health: state.health, loadFraction: state.loadFraction,
    targetLoadFraction: state.targetLoadFraction, accumulatedCostUsd: state.accumulatedCostUsd,
    burnRatePerHourUsd: state.burnRatePerHourUsd, topologyRevision: state.topologyRevision,
    metricsTopologyRevision: state.metricsTopologyRevision, measurementFreshness: state.measurementFreshness,
    resources: [...state.resources].sort((a, b) => a.id.localeCompare(b.id)), pools: state.pools,
    activeChaos: state.activeChaos, restarting: [...state.restarting ?? []].sort(), installedSkus: state.installedSkus });
}
