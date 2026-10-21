import pin from "./enginePin.json";
import { browserLimits, canonical, hash, sha256, fingerprintFields, digestPattern } from "./protocol";
import type { BrowserRequest, BrowserResult, BrowserEvidence, BrowserEngine } from "./protocol";

export interface SavedDesignRevision { infrastructureId: string; updatedAt: string; revision: string }
export interface SubmissionOptions {
  design: SavedDesignRevision; run: BrowserRequest; result: BrowserResult;
  idempotencyKey: string; purpose: "private" | "shared" | "scored";
}
export interface SubmissionReceipt { id: string; reused: boolean }
export interface SubmissionProjection {
  id: string; ownerId: string; status: "queued" | "running" | "terminal" | "recovery"; cancelRequested: boolean;
  seed: string; engine: BrowserEngine; browserCut: BrowserEvidence; durablePrefix: unknown;
  result: { verification: "unverified" | "verified" | "mismatch" | "interrupted" | "unavailable" | "cancelled"; [key: string]: unknown } | null;
  resultHash: string | null;
}
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
  async function request(path: string, init: RequestInit, signal?: AbortSignal) {
    if (!configuration.owner()) throw Error("Authenticated owner required");
    const response = await transport(endpoint + path, { ...init, signal, credentials: "same-origin", cache: "no-store", redirect: "error" });
    if (!response.ok) throw new SubmissionError(response.status);
    return response;
  }
  return {
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
      // Slice 11's strict schema has no owner/input/seed fields: session supplies
      // owner, saved design supplies input, and policy carries the explicit seed.
      const body = canonical({ infrastructureId: design.infrastructureId, expectedDesignUpdatedAt: design.updatedAt,
        expectedDesignRevision: design.revision, idempotencyKey: snapshot.idempotencyKey, purpose: snapshot.purpose,
        engine: run.engine, workload: run.input.recording, policy: run.input.policy, browserCut: evidence });
      // Recheck after hashing: a logout/owner switch must not reuse prior work.
      if (configuration.owner() !== owner) throw Error("Authenticated owner changed during submission");
      const response = await request("/", { method: "POST", headers: { "content-type": "application/json" }, body }, signal);
      const receipt = await response.json() as SubmissionReceipt;
      if (!uuid.test(receipt.id) || typeof receipt.reused !== "boolean") throw Error("Invalid submission receipt");
      return receipt;
    },
    async read(id: string, signal?: AbortSignal): Promise<SubmissionProjection> {
      const response = await request(`/${runId(id)}`, { method: "GET" }, signal);
      const projection = await response.json() as SubmissionProjection;
      if (projection.id !== id || projection.ownerId !== configuration.owner() || !["queued", "running", "terminal", "recovery"].includes(projection.status)) throw Error("Invalid owned submission projection");
      return projection;
    },
    async cancel(id: string, signal?: AbortSignal): Promise<void> {
      await request(`/${runId(id)}/cancel`, { method: "POST" }, signal);
    },
  };
}
