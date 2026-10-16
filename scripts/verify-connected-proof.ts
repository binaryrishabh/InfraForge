import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { readEnvelope } from "../apps/backend/internalModel2/envelope";
import { readCapture } from "../apps/backend/internalModel2/capture";
import { contentHash, executionSource } from "../apps/backend/internalModel2/identity";
import { internalReport, replayStored } from "../apps/backend/internalModel2/report";
import { verifyConnectedState } from "../apps/backend/tests/connectedAssertions";
import { decodeCausal } from "../apps/backend/internalModel2/causalJournal";
export function verifyConnectedProof(proof: any) {
  assert.equal(proof.schema, "infraforge-connected-product-proof/1"); assert.equal(proof.success, true); assert.equal(proof.rowsRemoved, true); assert.equal(proof.source, executionSource); assert.match(proof.commit, /^[a-f0-9]{40}$/);
  for (const name of ["authentication and operator-only scope", "cross-owner refusal", "saved revision and compiler refusal", "atomic outbox and exact retry", "healthy connected identities", "two-target distribution", "app failure and health detection lag", "surviving CPU pressure and DB consequence", "readiness and health recovery", "timeout after commit", "timeout before commit", "causal overflow remains Unknown", "read-only deterministic replay", "actual worker SIGKILL retains durable v2 prefix", "exact retry survives saved revision change", "read-only HTML exposes connected evidence"]) assert(proof.cases.includes(name), `Missing connected case: ${name}`);
  assert(proof.processes.filter((p: any) => p.name === "worker").length >= 3);
  assert.deepEqual(proof.runs.map((r: any) => r.name).sort(), ["healthy", "failure", "late-cancel", "early-cancel", "overflow", "worker-prefix"].sort());
  for (const saved of proof.runs) {
    const row = saved.row, input = readEnvelope(row.input, row.inputHash), e = readCapture(row.evidence, row.inputHash);
    assert.equal(input.schema, "infraforge-internal-execution/2"); assert.equal(e.schema, "infraforge-internal-evidence/2"); if (e.schema !== "infraforge-internal-evidence/2") throw Error("Expected v2 evidence");
    assert.equal(input.runId, row.id); assert.equal(input.ownerId, row.ownerId); assert.equal(e.sequence, row.sequence); assert.equal(e.throughUs, row.throughUs);
    assert.equal(saved.inputBytes, Buffer.byteLength(JSON.stringify(row.input))); assert.equal(saved.evidenceBytes, Buffer.byteLength(JSON.stringify(row.evidence)));
    assert(saved.inputBytes <= 524288 && saved.evidenceBytes <= 262144); verifyConnectedState(e);
    assert.equal(contentHash(replayStored(row)), contentHash(saved.replay)); assert.equal(saved.replay.kind, "MatchesRecordedPrefix"); assert.equal(contentHash(internalReport(row)), saved.reportHash);
    if (saved.name === "worker-prefix") { assert.equal(row.status, "interrupted"); assert.equal(row.sequence, 8); assert.equal(saved.replay.complete, false); }
    else assert.equal(row.status, "completed");
  }
  const run = (name: string) => proof.runs.find((r: any) => r.name === name).row.evidence;
  const healthy = run("healthy"), failed = run("failure"), events = decodeCausal(failed.model.causal);
  assert(healthy.model.routing[0].backends.every((b: any) => b.selected > 0));
  const detection = events.find(v => v.kind === "health-observation" && String(v.detail.id).includes("app-a") && String(v.detail.detail).endsWith("false"))!;
  assert(detection && detection.atUs > 17000);
  assert(events.some(v => v.kind === "lb-selected" && v.detail.detail === "app-a" && v.atUs > 17000 && v.atUs < detection.atUs));
  assert(!events.some(v => v.kind === "lb-selected" && v.detail.detail === "app-a" && v.atUs >= detection.atUs && v.atUs < 45000));
  assert(events.some(v => v.kind === "app-terminal" && v.resource === "app-a" && v.detail.outcome === "rejected" && v.atUs === 17000));
  assert.deepEqual(failed.checkpoints.find((p: any) => p.atUs === 34000).endpoints["app-a"], { alive: true, ready: false });
  assert.deepEqual(failed.checkpoints.find((p: any) => p.atUs === 39000).endpoints["app-a"], { alive: true, ready: true });
  assert(failed.model.database[0].transactions.committed < healthy.model.database[0].transactions.committed);
  assert(failed.model.resources.find((r: any) => r.id === "app-b").consumedCoreUs > healthy.model.resources.find((r: any) => r.id === "app-b").consumedCoreUs);
  for (const name of ["late-cancel", "early-cancel"]) {
    const e = run(name), tx = decodeCausal(e.model.causal).find(v => v.kind === "db-terminal" && v.work?.operation === "write")!;
    assert.equal(e.model.counts.deadlineExceeded, 1); assert.equal(e.model.database[0].rows[0].version, name === "late-cancel" ? 2 : 1); assert.equal(tx.detail.outcome, name === "late-cancel" ? "committed" : "cancelled");
  }
  assert.equal(run("overflow").completeness.exactCausality, false); assert(run("overflow").model.causal.omitted > 0);
  return { verified: true, commit: proof.commit, cases: proof.cases.length, runs: proof.runs.length, bytes: proof.runs.map((r: any) => ({ name: r.name, input: r.inputBytes, evidence: r.evidenceBytes })) };
}
if (import.meta.main) { const path = process.argv[2]; if (!path || process.argv.length !== 3) throw Error("Supply one connected product proof"); const bytes = readFileSync(path); assert(bytes.length <= 4194304); console.info(JSON.stringify(verifyConnectedProof(JSON.parse(bytes.toString())))); }
