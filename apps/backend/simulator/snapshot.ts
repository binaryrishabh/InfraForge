import { buildPoolSnapshots } from "@infraforge/simulation/engine";
import { computeHourlyBurnRateUsd } from "@infraforge/simulation/cost";
import type { SimulationLog, SimulationSnapshot } from "@infraforge/contracts/telemetry";
import type { SimulationInstance } from "./instance";

export function buildSnapshot(deploymentId: string, instance: SimulationInstance, logs: SimulationLog[] = []): SimulationSnapshot {
  const pools = buildPoolSnapshots(instance.state);
  return { deploymentId, timestamp: new Date().toISOString(), simulatedSeconds: instance.state.simulatedSeconds,
    loadFraction: instance.state.loadFraction, metrics: instance.state.metrics, logs, health: instance.state.overallHealth,
    pools: pools.pools, spawnedVms: pools.spawnedVms, restarting: instance.state.verticalScaling.map((v) => v.resourceId),
    activeChaos: instance.state.activeChaos, speed: instance.speed,
    burnRatePerHourUsd: computeHourlyBurnRateUsd(instance.state), accumulatedCostUsd: instance.accumulatedCostUsd,
    liveTopology: instance.topology, topologyRevision: instance.topologyRevision };
}

export function captureSnapshot(deploymentId: string, instance: SimulationInstance, kind: "terminal" | "checkpoint") {
  const snapshot = buildSnapshot(deploymentId, instance, [...instance.pendingLogs]);
  return structuredClone({ ...snapshot, version: 1, kind, capturedAt: snapshot.timestamp,
    topologyRevision: instance.topologyRevision,
    metricsComputedAt: instance.metricsComputedAt, metricsTopologyRevision: instance.metricsTopologyRevision,
    overallHealth: snapshot.health, targetLoadFraction: instance.state.targetLoadFraction,
    verticalScaling: instance.state.verticalScaling,
    installedSkus: Object.fromEntries(Object.entries(instance.state.resourceSkus).map(([id, sku]) => [id, sku.skuId])) });
}
