import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { contentHash } from "../apps/backend/internalModel2/identity";
import { readEnvelope } from "../apps/backend/internalModel2/envelope";
import { readCapture } from "../apps/backend/internalModel2/capture";
import { internalReport, replayStored } from "../apps/backend/internalModel2/report";
import { lessonSummary } from "../apps/backend/internalModel2/lessonSummary";
import { readLessonPolicy } from "../apps/backend/internalModel2/lessonPolicy";
import { lessonSource } from "./m2m-lineage";
const path = process.argv[2]; if (!path || process.argv.length !== 3) throw Error("Supply one retained M2M preview proof");
const bytes = readFileSync(path); assert(bytes.length <= 4194304);
const proof = JSON.parse(bytes.toString());
assert.equal(proof.schema, "infraforge-m2m-preview/1"); assert.equal(proof.success, true); assert.equal(proof.rowsRemoved, true);
assert.equal(proof.upgrade.before, proof.upgrade.after); assert.equal(proof.upgrade.existingGrantScope, "operator"); assert.equal(proof.upgrade.unscopedAdmissionRejected, true);
assert.match(proof.commit, /^[a-f0-9]{40}$/); assert.equal(proof.source, lessonSource());
assert.equal(proof.browser.executed, true); assert.equal(proof.browser.cases.length, 7); assert(proof.browser.cases.includes("phase editing and explicit saved/history refresh")); assert(proof.cases.length >= 17);
for (const required of ["authentication and scoped operator refusal", "strict choices and stale review refusal", "owned explicit design creation", "read-only review", "idempotent retry and mismatch refusal", "cross-owner isolation", "unsupported design preserved", "queued cancellation", "three supported phases execute in isolated worker", "isolated replay writes nothing", "kernel enforcement receipts", "immutable policy and terminal persistence", "parent death retains committed prefix", "ownership loss prevents later commits", "running cancellation", "grant revocation stops execution", "capture persistence failure retains prefix", "corrupt evidence remains Unknown", "missing runner refuses review and replay without inline fallback", "retry recovers original admission after runner configuration changes", "parked lesson runner preserves Model-1 worker startup", "scope downgrade hides advanced owned reports"]) assert(proof.cases.includes(required), `Missing ${required}`);
assert.deepEqual(proof.runs.filter((r: any) => r.phase).map((r: any) => r.phase).sort(), ["after", "before", "during"]);
assert.deepEqual(proof.runs.filter((r: any) => r.failure).map((r: any) => r.failure).sort(), ["cancel", "ownership-loss", "persistence", "process-death", "revoke"]);
for (const saved of proof.runs) {
  const row = saved.row, input = readEnvelope(row.input, row.inputHash), capture = readCapture(row.evidence, row.inputHash), policy = readLessonPolicy(saved.policy, row.inputHash);
  assert.equal(input.runId, row.id); assert.equal(input.ownerId, row.ownerId); assert.equal(capture.sequence, row.sequence); assert.equal(capture.throughUs, row.throughUs); assert.equal(capture.source, input.source);
  assert.equal(contentHash(replayStored(row)), contentHash(saved.replay));
  if (saved.phase) {
    assert.equal(policy.phase, saved.phase); assert.equal(policy.image, proof.image); assert.equal(saved.receipt.inspection.image, proof.image);
    assert.equal(row.status, "completed"); assert.equal(saved.receipt.exit.code, 0); assert.equal(saved.receipt.exit.oom, false);
    assert.equal(saved.receipt.enforcement.memory, "536870912"); assert.equal(saved.receipt.enforcement.pids, "64");
    assert.equal(contentHash(lessonSummary(row, saved.policy, saved.receipt)), contentHash(saved.report.lesson));
    assert.equal(contentHash({ ...internalReport(row), lesson: lessonSummary(row, saved.policy, saved.receipt) }), contentHash(saved.report));
    assert.equal(saved.report.lesson.readOutcome, saved.phase === "during" ? "rejected" : "completed");
  } else {
    assert.equal(saved.replay.complete, false); assert.equal(row.status, ["cancel", "revoke"].includes(saved.failure) ? "cancelled" : "interrupted");
    if (!["cancel", "revoke"].includes(saved.failure)) assert.equal(row.sequence, 3);
  }
}
assert.equal(proof.runs.length, 8);
for (const mode of ["cpu", "memory", "wall", "oversized", "malformed"]) assert(proof.os.results[mode].failure);
assert.equal(proof.os.results.controls.value.readonly, true); assert.equal(proof.os.results.controls.value.network, true);
assert.equal(proof.os.results.pids.value.denied, true); assert(proof.os.results.pids.value.count > 0 && proof.os.results.pids.value.count < 64);
assert.equal(proof.os.results.memory.receipt.exit.oom, true); assert.equal(proof.os.results.cpu.receipt.exit.oom, false);
assert(proof.os.results.cpu.elapsedMs < 15000); assert(proof.os.results.wall.elapsedMs >= 14000 && proof.os.results.wall.elapsedMs < 25000);
assert.equal(proof.os.orphan.parentKilled, true); assert.equal(proof.os.orphan.state.Running, false); assert.match(proof.os.orphan.overlapRefused, /still active/);
console.info(JSON.stringify({ verified: true, commit: proof.commit, source: proof.source, image: proof.image, runs: proof.runs.length, cases: proof.cases.length, browser: proof.browser.browser, bytes: bytes.length }));
