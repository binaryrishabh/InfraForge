import { buildPoolSnapshots } from "@infraforge/simulation/engine";
import { experimentWindow } from "@infraforge/contracts/reports";
import type { RecordedExperiment } from "@infraforge/contracts/challenges";
import type { SimulationInstance } from "../simulator/instance";
import { evidencePayload, sampleHash, type EvidenceBuffer } from "./contract";

export function createEvidenceBuffer(plan: RecordedExperiment | null, evaluationSecond: number | null | undefined): EvidenceBuffer | null {
  const window = plan && experimentWindow(plan, evaluationSecond);
  return window ? { window, pending: [] } : null;
}

export function captureEvidenceTick(instance: SimulationInstance) {
  const buffer = instance.evidence, second = instance.state.simulatedSeconds;
  if (!buffer || second < buffer.window.start || second > buffer.window.end) return;
  try {
    if (!instance.metricsComputedAt) throw new Error("Experiment evidence requires a completed tick");
    const pools = buildPoolSnapshots(instance.state).pools;
    const payload = evidencePayload.parse({ version: 1, topologyRevision: instance.metricsTopologyRevision,
      overallHealth: instance.state.overallHealth, loadFraction: instance.state.loadFraction,
      targetLoadFraction: instance.state.targetLoadFraction,
      resources: Object.entries(instance.state.metrics).map(([id, value]) => ({ id, ...value })),
      pools: Object.entries(pools).map(([id, pool]) => ({ id, currentReplicas: pool.currentReplicas, baseReplicas: pool.baseVmIds.length, pending: pool.pending })),
    });
    buffer.pending.push({ simulatedSeconds: second, sampledAt: new Date(instance.metricsComputedAt), payload, hash: sampleHash(payload) });
  } catch (error) {
    buffer.captureError = new Error("The completed tick could not be captured within the experiment evidence contract; advancement is frozen", { cause: error });
    throw buffer.captureError;
  }
}
