import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { readEnvelope } from "../apps/backend/internalModel2/envelope";
import { readCapture } from "../apps/backend/internalModel2/capture";
import { contentHash } from "../apps/backend/internalModel2/identity";
import { internalReport, replayStored } from "../apps/backend/internalModel2/report";
import type { InternalRunRow } from "../apps/backend/internalModel2/store";
import { workspaceSource } from "../apps/backend/tests/integration/model2WorkspaceSource";

// Content reconstruction complements the actual browser/DB/worker producer logs.
const path = process.argv[2];
if (!path || process.argv.length !== 3) throw Error("Supply one M2L browser-proof JSON path");
const bytes = await readFile(path);
assert(bytes.length <= 1048576, "Browser proof exceeds one MiB");
const proof = JSON.parse(bytes.toString("utf8"));
assert.equal(proof.schema, "infraforge-m2l-browser/1");
assert.equal(proof.success, true);
assert.match(proof.commit, /^[a-f0-9]{40}$/);
assert.equal(proof.source, workspaceSource(), "Workspace source changed since the browser proof");
assert.match(proof.browser, /^\d+\./);
assert.equal(proof.rowsRemoved, true);
for (const name of ["review editing and saved/history refresh", "mobile authoring"]) assert(proof.cases.includes(name), `Missing case: ${name}`);
for (const name of ["read-only server validation", "stale saved revision", "authoritative compiler refusal", "validation authorization and owner isolation", "grant refusal", "unsupported saved design", "server field errors", "keyboard review", "lost response + refresh + duplicate click", "queued GUI cancellation", "running GUI cancellation retains committed prefix", "real saved design → author → review → worker → report", "deterministic GUI replay", "worker-absent interrupted report", "corrupt evidence", "historical source mismatch", "mobile no page overflow", "two browser owner isolation", "grant revocation", "lost session"]) assert(proof.cases.includes(name), `Missing case: ${name}`);
for (const [name, expectedStatus] of [["complete", "completed"], ["interrupted", "interrupted"], ["cancelled", "cancelled"], ["queued", "cancelled"]]) {
  const saved = proof[name];
  assert.equal(saved.status, expectedStatus);
  const input = readEnvelope(saved.input, saved.input.fingerprint);
  assert.equal(input.runId, saved.id);
  const row: InternalRunRow = { id: input.runId, ownerId: input.ownerId, infrastructureId: input.infrastructureId,
    idempotencyKey: "artifact-reconstruction", requestHash: "0".repeat(64), input, inputHash: input.fingerprint,
    status: saved.status, token: "artifact-read-only", sequence: saved.sequence, throughUs: saved.throughUs,
    evidence: saved.capture, cancelRequested: expectedStatus === "cancelled", reason: saved.reason,
    createdAt: new Date(proof.startedAt), updatedAt: new Date(proof.endedAt) };
  assert.equal(contentHash(internalReport(row)), contentHash(saved.report));
  if (name === "queued") { assert.equal(saved.sequence, 0); assert.equal(saved.capture, null); continue; }
  const capture = readCapture(saved.capture, input.fingerprint);
  assert.equal(capture.sequence, saved.sequence);
  assert.equal(capture.throughUs, saved.throughUs);
  const replay = replayStored(row);
  assert.equal(replay.kind, "MatchesRecordedPrefix");
  assert.equal(replay.complete, name === "complete");
  assert.equal(contentHash(replay), contentHash(saved.replay));
  if (name === "interrupted") assert.equal(saved.sequence, 3);
  if (name === "complete") assert.equal(capture.model.commands.results.length, 3);
}
console.info(JSON.stringify({ verified: true, producerCommit: proof.commit, browser: proof.browser, cases: proof.cases.length,
  input: proof.complete.input.fingerprint, evidence: proof.complete.capture.fingerprint, bytes: bytes.length }));
