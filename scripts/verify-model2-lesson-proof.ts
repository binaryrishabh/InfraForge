import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { contentHash } from "../apps/backend/internalModel2/identity";
import { readEnvelope } from "../apps/backend/internalModel2/envelope";
import { readCapture } from "../apps/backend/internalModel2/capture";
import { replayStored } from "../apps/backend/internalModel2/report";
import { lessonSummary } from "../apps/backend/internalModel2/lessonSummary";
import { readLessonPolicy } from "../apps/backend/internalModel2/lessonPolicy";
import { lessonSource } from "./m2m-lineage";
const path = process.argv[2]; if (!path || process.argv.length !== 3) throw Error("Supply one retained M2M preview proof");
const bytes = readFileSync(path); assert(bytes.length <= 4194304);
const proof = JSON.parse(bytes.toString());
assert.equal(proof.schema, "infraforge-m2m-preview/1"); assert.equal(proof.success, true); assert.equal(proof.rowsRemoved, true);
assert.match(proof.commit, /^[a-f0-9]{40}$/); assert.equal(proof.source, lessonSource());
assert.equal(proof.browser.executed, true); assert.equal(proof.browser.cases.length, 6); assert(proof.cases.length >= 17);
for (const saved of proof.runs) {
  const row = saved.row; readEnvelope(row.input, row.inputHash); readCapture(row.evidence, row.inputHash); readLessonPolicy(saved.policy, row.inputHash);
  assert.equal(contentHash(replayStored(row)), contentHash(saved.replay));
  if (saved.phase) {
    assert.equal(row.status, "completed"); assert.equal(saved.receipt.exit.code, 0); assert.equal(saved.receipt.exit.oom, false);
    assert.equal(saved.receipt.enforcement.memory, "536870912"); assert.equal(saved.receipt.enforcement.pids, "64");
    assert.equal(contentHash(lessonSummary(row, saved.policy, saved.receipt)), contentHash(saved.report.lesson));
    assert.equal(saved.report.lesson.readOutcome, saved.phase === "during" ? "rejected" : "completed");
  } else { assert.equal(saved.replay.complete, false); assert(["cancelled", "interrupted"].includes(row.status)); }
}
assert.equal(proof.runs.length, 8);
for (const mode of ["cpu", "memory", "wall", "oversized", "malformed"]) assert(proof.os.results[mode].failure);
assert.equal(proof.os.results.controls.value.readonly, true); assert.equal(proof.os.results.controls.value.network, true);
assert.equal(proof.os.results.pids.value.denied, true); assert(proof.os.results.pids.value.count > 0 && proof.os.results.pids.value.count < 64);
assert.equal(proof.os.results.memory.receipt.exit.oom, true); assert.equal(proof.os.results.cpu.receipt.exit.oom, false);
assert(proof.os.results.cpu.elapsedMs < 15000); assert(proof.os.results.wall.elapsedMs >= 14000 && proof.os.results.wall.elapsedMs < 25000);
assert.equal(proof.os.orphan.parentKilled, true); assert.equal(proof.os.orphan.state.Running, false); assert.match(proof.os.orphan.overlapRefused, /still active/);
console.info(JSON.stringify({ verified: true, commit: proof.commit, source: proof.source, image: proof.image, runs: proof.runs.length, cases: proof.cases.length, browser: proof.browser.browser, bytes: bytes.length }));
