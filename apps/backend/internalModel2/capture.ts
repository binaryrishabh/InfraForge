import { boundedProduct, createMeteredProductModel2, presentModel2 } from "@infraforge/simulation/internal-product";
import type { ProductEvidence } from "@infraforge/simulation/internal-product";
import { hasher, contentHash } from "./identity";
import type { ExecutionEnvelope } from "./envelope";
import { INTERNAL_LIMITS as limits, jsonBytes } from "./budgets";
export const instantiate = (envelope: ExecutionEnvelope) => createMeteredProductModel2(envelope.compiled, envelope.metering, hasher);
function checkpoint(model: ProductEvidence) { return { atUs: model.at, endpoints: model.network.endpoints, counts: model.counts,
  objects: model.asynchronous.objects.map((s) => ({ id: s.id, bytes: s.storedBytes, generation: s.generation, objects: s.objects.length })) }; }
export type CaptureCheckpoint = ReturnType<typeof checkpoint>;
export function capture(runtime: ReturnType<typeof instantiate>, envelope: ExecutionEnvelope, sequence: number, history: CaptureCheckpoint[] = []) {
  const { model } = runtime.evidence(), frame = runtime.frame();
  if (sequence !== history.length + 1 || sequence > limits.captures) throw Error("Capture history sequence/budget mismatch");
  const body = { schema: "infraforge-internal-evidence/1" as const, input: envelope.fingerprint, source: envelope.source, sequence, throughUs: model.at,
    checkpoints: [...history, checkpoint(model)],
    model: { capture: model.capture, counts: model.counts, resources: model.resources.map((r) => ({ id: r.id, received: r.received, completed: r.completed, rejected: r.rejected, failed: r.failed, cancelled: r.cancelled, queued: r.queued, consumedCoreUs: r.consumedCoreUs })),
      objects: model.asynchronous.objects, commands: model.systems.commands, endpoints: model.network.endpoints, faults: model.faults,
      networkInterventions: model.network.trace.events.filter((r) => r.kind === "network-intervention"), networkTraceOmitted: model.network.trace.omitted },
    presentation: presentModel2(model), usage: frame };
  const value = { ...body, fingerprint: contentHash(body) }; jsonBytes(value, limits.evidenceBytes); return value;
}
export type StoredCapture = ReturnType<typeof capture>;
export function readCapture(value: unknown, input: string): StoredCapture {
  boundedProduct(value); jsonBytes(value, limits.evidenceBytes);
  const e = value as StoredCapture, { fingerprint, ...body } = e;
  if (e.schema !== "infraforge-internal-evidence/1" || contentHash(body) !== fingerprint || e.input !== input) throw Error("Stored evidence is missing, corrupt or incompatible");
  if (!Number.isSafeInteger(e.sequence) || e.sequence < 1 || e.sequence > limits.captures || !Array.isArray(e.checkpoints) || e.checkpoints.length !== e.sequence || e.checkpoints.at(-1)?.atUs !== e.throughUs || e.usage.snapshot.atUs !== e.throughUs) throw Error("Stored evidence checkpoint sequence or time gap");
  return e;
}
