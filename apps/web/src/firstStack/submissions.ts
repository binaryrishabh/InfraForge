import pin from "./enginePin.json";
import { browserLimits, canonical, hash, sha256, fingerprintFields, digestPattern } from "./protocol";
import type { BrowserRequest, BrowserResult } from "./protocol";
import type { FirstStackSubmissionAvailability, FirstStackSubmissionRecord, ScoredChallengeVersion } from "@infraforge/contracts/reports";

export interface SavedDesignRevision { infrastructureId: string; updatedAt: string; revision: string }
export type SubmissionOptions = {
  design: SavedDesignRevision; run: BrowserRequest; result: BrowserResult;
  idempotencyKey: string;
} & ({ purpose: "scored"; challenge: ScoredChallengeVersion } | { purpose: "private" | "shared"; challenge?: never });
export interface SubmissionReceipt { id: string; reused: boolean }
export type SubmissionProjection = FirstStackSubmissionRecord;
export class SubmissionError extends Error {
  constructor(readonly status: number) { super(`First-stack submission request failed (${status})`); }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const runId = (id: string) => { if (!uuid.test(id)) throw Error("Supply a submission UUID"); return id; };

// The route remains unmounted. A future host supplies its explicitly configured
// mount and current authenticated owner; browser owner data never authenticates.
export function createFirstStackSubmissionClient(configuration: { endpoint: string; owner(): string | null; fetch?: typeof fetch }) {
  if (!configuration.endpoint.startsWith("/") || configuration.endpoint.startsWith("//") || /[?#\\]/.test(configuration.endpoint)) throw Error("Supply a same-origin submission mount path");
  const endpoint = configuration.endpoint.replace(/\/$/, ""), transport = configuration.fetch ?? fetch;
  const assertOwner = (owner: string | null) => {
    if (!owner) throw Error("Authenticated owner required");
    if (configuration.owner() !== owner) throw Error("Authenticated owner changed during request");
  };
  async function request<T>(path: string, init: RequestInit, signal?: AbortSignal, owner = configuration.owner(), json = true): Promise<T> {
    assertOwner(owner);
    const response = await transport(endpoint + path, { ...init, signal, credentials: "same-origin", cache: "no-store", redirect: "error" });
    assertOwner(owner);
    if (!response.ok) throw new SubmissionError(response.status);
    const value = json ? await response.json() : undefined;
    assertOwner(owner);
    return value as T;
  }
  async function availability(signal?: AbortSignal, owner = configuration.owner()): Promise<FirstStackSubmissionAvailability> {
    const value = await request<FirstStackSubmissionAvailability>("/availability", { method: "GET" }, signal, owner);
    if (value?.available === false && value.engine === null) return value;
    if (value?.available !== true || value.engine?.source !== pin.source || !/^sha256:[a-f0-9]{64}$/.test(value.engine.image) ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now()) throw Error("Approved engine unavailable or browser pin stale; run again under the approved engine");
    return value;
  }
  return {
    availability,
    async submit(options: SubmissionOptions, signal?: AbortSignal): Promise<SubmissionReceipt> {
      // Snapshot before any async hash so concurrent edits cannot replace the
      // checked seed, workload, engine or cut between validation and transport.
      const snapshot = JSON.parse(canonical(options)) as SubmissionOptions;
      const { run, result, design } = snapshot, owner = configuration.owner(), evidence = result.evidence;
      if (!owner || owner !== run.input.owner) throw Error("Run owner differs from the authenticated owner");
      canonical(run);
      if (run.engine.source !== pin.source || evidence?.source !== pin.source || evidence.schema !== "first-stack-isolated-cut/1" ||
        result.status !== "completed" || evidence.cut.interruption || !evidence.cut.completeness.horizonReached) throw Error("Supply a finished run under the pinned engine");
      canonical(evidence, browserLimits.frameBytes);
      if (evidence.inputHash !== await sha256(canonical(run.input)) || evidence.fingerprint !== await hash(fingerprintFields(evidence.cut)) ||
        evidence.cut.lock.designRevision !== design.revision || !digestPattern.test(design.revision) ||
        canonical(run.input.layout.firstStack) !== canonical(run.input.candidate)) throw Error("Submission input, design or browser evidence changed");
      if (!uuid.test(design.infrastructureId) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(design.updatedAt) || !Number.isFinite(Date.parse(design.updatedAt))) throw Error("Supply the exact saved design revision and timestamp");
      if (!snapshot.idempotencyKey || snapshot.idempotencyKey.length > 80 || !["private", "shared", "scored"].includes(snapshot.purpose)) throw Error("Supply submission purpose and idempotency key");
      if (snapshot.purpose === "scored" ? !snapshot.challenge || !snapshot.challenge.id || snapshot.challenge.id.length > 80 ||
        !snapshot.challenge.version || snapshot.challenge.version.length > 32 : snapshot.challenge !== undefined) throw Error("Supply an exact challenge id and version for scored submissions");
      const approved = await availability(signal, owner);
      if (!approved.available) throw new SubmissionError(503);
      if (canonical(approved.engine) !== canonical(run.engine)) throw Error("Approved engine changed; run again under the approved engine");
      // Slice 11's strict schema has no owner/input/seed fields: session supplies
      // owner, saved design supplies input, and policy carries the explicit seed.
      const body = canonical({ infrastructureId: design.infrastructureId, expectedDesignUpdatedAt: design.updatedAt,
        expectedDesignRevision: design.revision, idempotencyKey: snapshot.idempotencyKey, purpose: snapshot.purpose,
        engine: approved.engine, workload: run.input.recording, policy: run.input.policy, browserCut: evidence,
        ...(snapshot.purpose === "scored" ? { challenge: snapshot.challenge } : {}) });
      // Recheck after hashing: a logout/owner switch must not reuse prior work.
      if (configuration.owner() !== owner) throw Error("Authenticated owner changed during submission");
      const receipt = await request<SubmissionReceipt>("/", { method: "POST", headers: { "content-type": "application/json" }, body }, signal, owner);
      if (!receipt || !uuid.test(receipt.id) || typeof receipt.reused !== "boolean") throw Error("Invalid submission receipt");
      return receipt;
    },
    async read(id: string, signal?: AbortSignal): Promise<SubmissionProjection> {
      const projection = await request<SubmissionProjection>(`/${runId(id)}`, { method: "GET" }, signal);
      if (projection?.schema !== "infraforge-run-record/1" || projection.id !== id || projection.reference?.id !== id ||
        projection.reference.engine !== "2" || projection.reference.store !== "FirstStackRun" || projection.engine?.lineage !== "2" ||
        !["queued", "running", "terminal", "recovery"].includes(projection.status)) throw Error("Invalid submission RunRecord projection");
      return projection;
    },
    async cancel(id: string, signal?: AbortSignal): Promise<void> {
      await request<void>(`/${runId(id)}/cancel`, { method: "POST" }, signal, configuration.owner(), false);
    },
  };
}
