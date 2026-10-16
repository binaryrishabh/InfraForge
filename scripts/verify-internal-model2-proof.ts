import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { readEnvelope } from "../apps/backend/internalModel2/envelope";
import { readCapture } from "../apps/backend/internalModel2/capture";
import { contentHash } from "../apps/backend/internalModel2/identity";
import { internalReport, replayStored } from "../apps/backend/internalModel2/report";
import type { InternalRunRow } from "../apps/backend/internalModel2/store";

// Reconstruct independently of the database and integration runner. CI logs and
// the producer commit establish the real product lifecycle; this checks content.
const path = process.argv[2];
if (!path || process.argv.length !== 3) throw Error("Supply one downloaded internal-model2-product-proof JSON path");
const bytes = await readFile(path);
assert(bytes.length <= 1048576, "Product proof exceeds one MiB");
const proof = JSON.parse(bytes.toString("utf8"));
assert.equal(proof.schema, "infraforge-model2-product-proof/1");
assert.equal(proof.success, true);
assert.match(proof.commit, /^[a-f0-9]{40}$/);
assert.match(proof.services.postgres, /^18\./);
assert.match(proof.services.redis, /^8\./);
assert(proof.workerProcesses.length >= 3, "Actual worker lifecycles must be retained");
const input = readEnvelope(proof.normal.input, proof.admission.inputHash);
const evidence = readCapture(proof.normal.capture, input.fingerprint);
const row: InternalRunRow = { id: input.runId, ownerId: input.ownerId, infrastructureId: input.infrastructureId,
  idempotencyKey: "artifact-reconstruction", requestHash: "0".repeat(64), input, inputHash: input.fingerprint,
  status: proof.normal.status, token: "artifact-read-only", sequence: evidence.sequence, throughUs: evidence.throughUs,
  evidence, cancelRequested: false, reason: null, createdAt: new Date(proof.startedAt), updatedAt: new Date(proof.endedAt) };
assert.equal(row.status, "completed");
assert.equal(contentHash(internalReport(row)), contentHash(proof.normal.report));
const replay = replayStored(row);
assert.equal(replay.kind, "MatchesRecordedPrefix");
assert.equal(replay.complete, true);
assert.equal(contentHash(replay), contentHash(proof.normal.replay));
assert.equal(Buffer.byteLength(JSON.stringify(input)), proof.normal.persistedInputBytes);
assert.equal(Buffer.byteLength(JSON.stringify(evidence)), proof.normal.persistedEvidenceBytes);
// Exact byte-time from independently specified object mutation boundaries.
const byteUs = BigInt(10 * (3004 - 1004) + 20 * (14004 - 3004) + 7 * (20000 - 16504));
assert.equal(byteUs.toString(), "264472");
assert.equal(evidence.usage.snapshot.measurements.find((m) => m.family === "object-store")?.byteUs, byteUs.toString());
for (const kind of ["process-death", "ownership-loss", "transactionFailure"]) {
  const failure = proof.failures[kind];
  assert.equal(failure.status, "interrupted"); assert.equal(failure.sequence, 3);
  if (failure.before) assert.equal(failure.before, failure.retained);
  if (failure.reportWithoutWorker) {
    assert.equal(failure.reportWithoutWorker.sequence, 3);
    assert.equal(failure.reportWithoutWorker.throughUs, 2500);
  }
}
for (const failure of Object.values(proof.failures) as Array<Record<string, any>>) {
  const recorded = readEnvelope(failure.input, failure.input.fingerprint);
  const captured = readCapture(failure.capture, recorded.fingerprint);
  assert.equal(recorded.runId, failure.id);
  assert.equal(captured.fingerprint, failure.retained);
  const prefix = { ...row, id: failure.id, ownerId: recorded.ownerId, input: recorded, inputHash: recorded.fingerprint,
    evidence: captured, sequence: failure.sequence, throughUs: failure.throughUs, status: failure.status, reason: failure.reason };
  assert.equal(replayStored(prefix).kind, "MatchesRecordedPrefix");
  assert.equal(replayStored(prefix).complete, false);
}
assert.equal(proof.failures.cancellation.status, "cancelled");
assert.equal(proof.failures.authorizationRevocation.status, "cancelled");
assert.equal(proof.failures.authorizationRevocation.unauthorizedReport, 404);
assert.equal(proof.fixtureRowsRemoved, true);
console.info(JSON.stringify({ verified: true, producerCommit: proof.commit, source: input.source,
  input: input.fingerprint, evidence: evidence.fingerprint, replay: replay.kind, byteUs: byteUs.toString(), bytes: bytes.length }));
