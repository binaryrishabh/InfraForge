import { prisma } from "../lib/prisma";
import { storedJson } from "../utils/json";
import type { SimulationInstance } from "../simulator/instance";
import { sampleHash } from "./contract";
import type { CapturedEvidence } from "./contract";

export async function persistEvidence(deploymentId: string, points: readonly CapturedEvidence[], database = prisma) {
  if (!points.length) return;
  await database.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Deployment" WHERE id = ${deploymentId} FOR UPDATE`;
    await tx.runEvidenceSample.createMany({ data: points.map((p) => ({ deploymentId, simulatedSeconds: p.simulatedSeconds,
      sampledAt: p.sampledAt, payload: storedJson(p.payload), hash: p.hash })), skipDuplicates: true });
    const existing = await tx.runEvidenceSample.findMany({ where: { deploymentId, simulatedSeconds: { in: points.map((p) => p.simulatedSeconds) } } });
    for (const point of points) {
      const row = existing.find((r) => r.simulatedSeconds === point.simulatedSeconds);
      if (!row || row.hash !== point.hash || sampleHash(row.payload) !== point.hash) {
        throw new Error(`Conflicting experiment evidence at simulated second ${point.simulatedSeconds}; retained evidence was not overwritten`);
      }
    }
  });
}

export async function flushEvidence(deploymentId: string, instance: SimulationInstance) {
  if (instance.evidence?.captureError) throw instance.evidence.captureError;
  const pending = instance.evidence?.pending;
  if (!pending?.length) return;
  await persistEvidence(deploymentId, pending);
  // Clear only after the transaction reply. A lost reply retries these exact captures.
  pending.length = 0;
}
