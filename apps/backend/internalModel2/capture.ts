import { createMeteredProductModel2 } from "@infraforge/simulation/internal-product";
import { hasher } from "./identity";
import type { ExecutionEnvelope } from "./envelope";
import * as v1 from "./captureV1";
import * as v2 from "./captureV2";
import { causalJournal } from "./causalJournal";
export function instantiate(envelope: ExecutionEnvelope) {
  if (envelope.schema === "infraforge-internal-execution/2") {
    const journal = causalJournal(envelope.causal);
    return { ...createMeteredProductModel2(envelope.compiled, envelope.metering, hasher, journal.observe), version: 2 as const, journal };
  }
  return { ...v1.instantiate(envelope), version: 1 as const };
}
export type CaptureCheckpoint = v1.CaptureCheckpoint | v2.CheckpointV2;
export type StoredCapture = v1.StoredCapture | v2.StoredCaptureV2;
export function capture(runtime: ReturnType<typeof instantiate>, envelope: ExecutionEnvelope, sequence: number, history: CaptureCheckpoint[] = []): StoredCapture {
  if (runtime.version === 2 && envelope.schema === "infraforge-internal-execution/2") return v2.captureV2(runtime, envelope, sequence, history as v2.CheckpointV2[], runtime.journal.capture());
  if (runtime.version !== 1 || envelope.schema !== "infraforge-internal-execution/1" || history.some(p => "connected" in p)) throw Error("Execution/evidence versions disagree");
  return v1.capture(runtime, envelope, sequence, history as v1.CaptureCheckpoint[]);
}
export function readCapture(value: unknown, input: string): StoredCapture {
  return (value as { schema?: string })?.schema === "infraforge-internal-evidence/2" ? v2.readCaptureV2(value, input) : v1.readCapture(value, input);
}
