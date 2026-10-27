import { experimentWindow } from "@infraforge/contracts/reports";
import type { RecordedExperiment } from "@infraforge/contracts/challenges";
import type { SimulationInstance } from "../simulator/instance";
import { evidencePayload, sampleHash, type EvidenceBuffer } from "./contract";
import { currentSecond, liveView } from "../simulator/engineView";

export function createEvidenceBuffer(plan: RecordedExperiment | null, evaluationSecond: number | null | undefined): EvidenceBuffer | null {
  const window = plan && experimentWindow(plan, evaluationSecond);
  return window ? { window, pending: [] } : null;
}

export function captureEvidenceTick(instance: SimulationInstance) {
  const buffer = instance.evidence, second = currentSecond(instance);
  if (!buffer || second < buffer.window.start || second > buffer.window.end) return;
  try {
    if (!instance.metricsComputedAt) throw new Error("Experiment evidence requires a completed tick");
    const view = liveView(instance), pools = view.pools;
    const payload = evidencePayload.parse({ version: 2, topologyRevision: instance.metricsTopologyRevision,
      overallHealth: view.overallHealth, loadFraction: view.loadFraction, targetLoadFraction: view.targetLoadFraction,
      // Evidence keeps the measured fields only; replica counts are retained in pools.
      resources: Object.entries(view.metrics).map(([id, { cpu, memory, rps, connections, health }]) => ({ id, health, cpu, memory,
        ...(rps === undefined ? {} : { rps }), ...(connections === undefined ? {} : { connections }) })),
      pools: Object.entries(pools).map(([id, pool]) => ({ id, currentReplicas: pool.currentReplicas, baseReplicas: pool.baseVmIds.length, pending: pool.pending })),
    });
    buffer.pending.push({ simulatedSeconds: second, sampledAt: new Date(instance.metricsComputedAt), payload, hash: sampleHash(payload) });
  } catch (error) {
    buffer.captureError = new Error("The completed tick could not be captured within the experiment evidence contract; advancement is frozen", { cause: error });
    throw buffer.captureError;
  }
}
