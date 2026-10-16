import { boundedProduct } from "@infraforge/simulation/internal-product";
import type { ProductEvidence, createMeteredProductModel2 } from "@infraforge/simulation/internal-product";
import type { ExecutionEnvelopeV2 } from "./envelopeV2";
import type { CausalCapture } from "./causalJournal";
import { readCausal } from "./causalJournal";
import { contentHash } from "./identity";
import { INTERNAL_LIMITS as limits, jsonBytes } from "./budgets";
import { connectedPresentation } from "./connectedPresentation";
import { validateConnectedProjection } from "./captureV2Validation";
const resourceState = (m: ProductEvidence) => m.resources.map(r => ({ id: r.id, received: r.received, admitted: r.admitted, rejected: r.rejected, completed: r.completed, failed: r.failed, cancelled: r.cancelled, queued: r.queued, serving: r.serving, waiting: r.waiting, consumedCoreUs: r.consumedCoreUs, ...(r.compute ? { workers: r.compute.workers, cpu: r.compute.cpu, memory: r.compute.memory } : {}) }));
function checkpoint(m: ProductEvidence) { return { atUs: m.at, endpoints: m.network.endpoints, counts: m.counts, objects: [], connected: { routing: m.network.loadBalancers, resources: resourceState(m).map(({ cpu: _cpu, memory: _memory, ...r }) => r), database: m.data.databases.map(d => ({ id: d.id, sessions: d.sessions, transactions: d.transactions, logicalReads: d.logicalReads, logicalWrites: d.logicalWrites, queued: d.queued })) } }; }
export type CheckpointV2 = ReturnType<typeof checkpoint>;
const databaseState = (m: ProductEvidence) => m.data.databases.map(d => ({ id: d.id, sessions: d.sessions, transactions: d.transactions, queryClasses: d.queryClasses, statements: d.statements, logicalReads: d.logicalReads, logicalWrites: d.logicalWrites, generatedLogBytes: d.generatedLogBytes, durableAcknowledgedCommits: d.durableAcknowledgedCommits, rows: d.rows, locks: d.locks, waiters: d.waiters, queries: d.queries, active: d.active, queued: d.queued, reasons: d.reasons, cpu: d.cpu }));
export function captureV2(runtime: ReturnType<typeof createMeteredProductModel2>, e: ExecutionEnvelopeV2, sequence: number, history: CheckpointV2[], causal: CausalCapture) {
  const { model: m } = runtime.evidence();
  const body = { schema: "infraforge-internal-evidence/2" as const, input: e.fingerprint, source: e.source, sequence, throughUs: m.at, checkpoints: [...history, checkpoint(m)],
    model: { capture: m.capture, counts: m.counts, resources: resourceState(m), endpoints: m.network.endpoints, faults: m.faults,
      callers: { results: m.results, inFlight: m.inFlight, retention: m.resultRetention, inFlightOmitted: m.inFlightOmitted, byOperation: m.byOperation },
      routing: m.network.loadBalancers, database: databaseState(m), network: { paths: m.network.paths, links: m.network.links }, causal },
    completeness: { exactCausality: causal.complete && m.resultRetention.omitted === 0 && m.inFlightOmitted === 0, causalOmitted: causal.omitted, callerOmitted: m.resultRetention.omitted + m.inFlightOmitted, throughUs: m.at },
    presentation: connectedPresentation(m), usage: runtime.frame() };
  if (history.some(p => !("connected" in p)) || sequence !== history.length + 1 || sequence > limits.captures) throw Error("V2 checkpoint version/sequence mismatch");
  const result = { ...body, fingerprint: contentHash(body) }; jsonBytes(result, limits.evidenceBytes); return result;
}
export type StoredCaptureV2 = ReturnType<typeof captureV2>;
export function readCaptureV2(value: unknown, input: string): StoredCaptureV2 {
  boundedProduct(value); jsonBytes(value, limits.evidenceBytes);
  const e = value as StoredCaptureV2, { fingerprint, ...body } = e;
  if (e.schema !== "infraforge-internal-evidence/2" || e.input !== input || contentHash(body) !== fingerprint || !Number.isSafeInteger(e.sequence) || e.sequence < 1 || e.sequence > limits.captures || e.checkpoints?.length !== e.sequence || e.checkpoints.some(p => !("connected" in p)) || e.checkpoints.at(-1)?.atUs !== e.throughUs || e.usage?.snapshot.atUs !== e.throughUs) throw Error("Stored v2 evidence is corrupt or incompatible");
  const c = readCausal(e.model.causal);
  validateConnectedProjection(e.model);
  if (!Number.isSafeInteger(e.throughUs) || e.throughUs < 0 || e.model.capture.throughUs !== e.throughUs || e.checkpoints.some((p, i) => !Number.isSafeInteger(p.atUs) || p.atUs < 0 || i > 0 && p.atUs <= e.checkpoints[i - 1]!.atUs) || c.firstOmittedAt !== null && c.firstOmittedAt > e.throughUs) throw Error("V2 checkpoint or omission time mismatch");
  if (e.completeness.causalOmitted !== c.omitted || e.completeness.callerOmitted !== e.model.callers.retention.omitted + e.model.callers.inFlightOmitted || e.completeness.exactCausality !== (c.complete && e.completeness.callerOmitted === 0) || e.completeness.throughUs !== e.throughUs || c.rows.some(r => r[0] > e.throughUs)) throw Error("V2 evidence completeness mismatch");
  return e;
}
