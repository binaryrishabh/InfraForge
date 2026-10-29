import type { SimulationLog, SimulationSnapshot } from "@infraforge/contracts/telemetry";
import type { SimulationInstance } from "./instance";
import { liveView } from "./engineView";

export function buildSnapshot(deploymentId: string, instance: SimulationInstance, logs: SimulationLog[] = []): SimulationSnapshot {
  const view = liveView(instance);
  return { deploymentId, timestamp: new Date().toISOString(), simulatedSeconds: view.simulatedSeconds,
    loadFraction: view.loadFraction, metrics: view.metrics, logs, health: view.overallHealth,
    pools: view.pools, spawnedVms: view.spawnedVms, restarting: view.restarting,
    activeChaos: view.activeChaos, speed: instance.speed,
    burnRatePerHourUsd: view.burnRatePerHourUsd, accumulatedCostUsd: instance.accumulatedCostUsd,
    liveTopology: instance.topology, topologyRevision: instance.topologyRevision, ...(view.traffic ? { traffic: view.traffic } : {}) };
}

export function captureSnapshot(deploymentId: string, instance: SimulationInstance, kind: "terminal" | "checkpoint") {
  const snapshot = buildSnapshot(deploymentId, instance, [...instance.pendingLogs]), view = liveView(instance);
  const applicationFlow = instance.model2.applicationFlowEvidence();
  return structuredClone({ ...snapshot, ...(applicationFlow ? { applicationFlow } : {}), version: 1, kind, capturedAt: snapshot.timestamp,
    topologyRevision: instance.topologyRevision,
    metricsComputedAt: instance.metricsComputedAt, metricsTopologyRevision: instance.metricsTopologyRevision,
    overallHealth: snapshot.health, targetLoadFraction: view.targetLoadFraction,
    verticalScaling: view.verticalScaling, installedSkus: view.installedSkus });
}
