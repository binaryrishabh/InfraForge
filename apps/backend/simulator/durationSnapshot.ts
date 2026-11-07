import type { DurationEvidence } from "@infraforge/contracts/reports";
import { DurationEvidenceSchema } from "../reports/durationSchema";

/** Structural read boundary also accepts internal finite-IO runs in proofs.
 * No events, counts or authored demands are converted into durations. */
interface Source {
  capture: { throughUs: number; timestampComplete?: boolean };
  resources: Array<{id: string; busySlotUs: number; consumedCoreUs: number; cancelled: number}>;
  computeConfiguration: Array<{id: string}>;
  dataConfiguration: Array<{id: string; kind: string}>;
  data: {databases: Array<{id: string; ioPhases?: {elapsedUs: Record<string, number>}}>};
  asynchronous?: {workers: Array<{id: string}>};
  network: {paths: Array<{id: string; source: string; target: string;
    completedPhaseDurationsUs: DurationEvidence["paths"][number]["reachedPhaseUs"];
    offered: number; completed: number; failed: number; cancelled: number; live: number; pool: {pending: number}}>} ;
}

export function durationSnapshot(e: Source): DurationEvidence {
  const owners = new Map<string, DurationEvidence["resources"][number]["kind"]>([
    ...e.computeConfiguration.map(r => [r.id, "compute"] as const),
    ...e.dataConfiguration.filter(r => r.kind === "relational").map(r => [r.id, "relational"] as const),
    ...(e.asynchronous?.workers.map(r => [r.id, "async-worker"] as const) ?? []),
  ]);
  const resources = [...owners].map(([id, kind]) => {
    const state = e.resources.find(r => r.id === id);
    const elapsed = e.data.databases.find(d => d.id === id)?.ioPhases?.elapsedUs;
    const phasesUs = elapsed ? {queued: elapsed.queued!, lock: elapsed.lock!, cpu: elapsed.cpu!, io: elapsed.io!, wait: elapsed.wait!, commit: elapsed.commit!} : null;
    return {id, kind, busySlotUs: state?.busySlotUs ?? null, consumedCoreUs: state?.consumedCoreUs ?? null,
      cancelled: state?.cancelled ?? null, phasesUs};
  });
  return DurationEvidenceSchema.parse({version: 1, fromUs: 0, throughUs: e.capture.throughUs,
    timestampComplete: e.capture.timestampComplete ?? null, resources: resources.slice(0, 64), resourcesOmitted: Math.max(0, resources.length - 64),
    paths: e.network.paths.slice(0, 64).map(p => ({id: p.id, source: p.source, target: p.target, reachedPhaseUs: {...p.completedPhaseDurationsUs},
      offered: p.offered, completed: p.completed, failed: p.failed, cancelled: p.cancelled, live: p.live,
      pendingAcquisitions: p.pool.pending, unfinishedAcquisitionUs: null})), pathsOmitted: Math.max(0, e.network.paths.length - 64)});
}
