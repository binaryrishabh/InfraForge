import { expect, test } from "bun:test";
import { connectedFixture } from "./connectedFixture";
import { verifyConnectedState } from "./connectedAssertions";
import { compileEnvelope, captureCuts, readEnvelope } from "../internalModel2/envelope";
import { capture, instantiate, readCapture } from "../internalModel2/capture";
import type { StoredCaptureV2 } from "../internalModel2/captureV2";
import { decodeCausal } from "../internalModel2/causalJournal";
import { contentHash } from "../internalModel2/identity";
import { internalReport, replayStored } from "../internalModel2/report";
import type { InternalRunRow } from "../internalModel2/store";
import { internalProductFixture } from "./model2Fixture";
function run(mode: Parameters<typeof connectedFixture>[0] = "healthy", prefix?: number) {
  const f = connectedFixture(mode), input = compileEnvelope("connected-run", "owner", f.layout, new Date(f.request.expectedDesignUpdatedAt), f.request), runtime = instantiate(input);
  let evidence: ReturnType<typeof capture> | undefined;
  for (const at of captureCuts(input).slice(0, prefix)) { runtime.advanceTo(at); evidence = capture(runtime, input, (evidence?.sequence ?? 0) + 1, evidence?.checkpoints); }
  if (evidence?.schema !== "infraforge-internal-evidence/2") throw Error("Expected v2 capture");
  const row: InternalRunRow = { id: input.runId, ownerId: input.ownerId, infrastructureId: input.infrastructureId, input, inputHash: input.fingerprint, evidence, sequence: evidence.sequence, throughUs: evidence.throughUs, status: prefix ? "interrupted" : "completed", reason: prefix ? "Interrupted after durable prefix" : null, token: null, requestHash: "0".repeat(64), idempotencyKey: "unit-proof", cancelRequested: false, createdAt: new Date(), updatedAt: new Date() };
  return { f, input, evidence, row, events: decodeCausal(evidence.model.causal) };
}
test("v2 retains exact caller → LB → app → DB → caller identities and finite work", () => {
  const r = run(); expect(verifyConnectedState(r.evidence).complete).toBe(true);
  expect(r.evidence.model.counts.completed).toBe(11); expect(r.evidence.model.routing[0]!.backends.map(b => b.selected)).toEqual([6, 6]);
  expect(readEnvelope(r.input, r.input.fingerprint)).toEqual(r.input); expect(readCapture(r.evidence, r.input.fingerprint)).toEqual(r.evidence);
  expect(Buffer.byteLength(JSON.stringify(r.input))).toBeLessThan(524288); expect(Buffer.byteLength(JSON.stringify(r.evidence))).toBeLessThan(262144);
});
test("app crash preserves detection lag, in-flight failure, survivor CPU pressure and separate recovery", () => {
  const r = run("failure"), healthy = run(); verifyConnectedState(r.evidence);
  const down = r.events.find(v => v.kind === "health-observation" && String(v.detail.id).includes("app-a") && String(v.detail.detail).endsWith("false"))!;
  expect(down.atUs).toBe(30000);
  expect(r.events.some(v => v.kind === "lb-selected" && v.detail.detail === "app-a" && v.atUs > 17000 && v.atUs < down.atUs)).toBe(true);
  expect(r.events.some(v => v.kind === "lb-selected" && v.detail.detail === "app-a" && v.atUs >= down.atUs && v.atUs < 45000)).toBe(false);
  expect(r.events.some(v => v.kind === "app-terminal" && v.resource === "app-a" && v.atUs === 17000 && v.detail.outcome === "rejected")).toBe(true);
  expect(r.evidence.checkpoints.find(p => p.atUs === 34000)!.endpoints["app-a"]).toEqual({ alive: true, ready: false });
  expect(r.evidence.checkpoints.find(p => p.atUs === 39000)!.endpoints["app-a"]).toEqual({ alive: true, ready: true });
  expect(r.events.some(v => v.kind === "lb-selected" && v.detail.detail === "app-a" && v.atUs > 39000)).toBe(true);
  expect(r.evidence.model.database[0]!.transactions.committed).toBeLessThan(healthy.evidence.model.database[0]!.transactions.committed);
  expect(r.evidence.model.resources.find(v => v.id === "app-b")!.consumedCoreUs).toBeGreaterThan(healthy.evidence.model.resources.find(v => v.id === "app-b")!.consumedCoreUs);
});
for (const mode of ["late-cancel", "early-cancel"] as const) test(`${mode}: caller timeout respects actual remote commit`, () => {
  const r = run(mode); verifyConnectedState(r.evidence);
  expect(r.evidence.model.counts.deadlineExceeded).toBe(1);
  expect(r.evidence.model.database[0]!.rows[0]!.version).toBe(mode === "late-cancel" ? 2 : 1);
  const terminal = r.events.find(v => v.kind === "db-terminal" && v.work?.operation === "write")!;
  expect(terminal.detail.outcome).toBe(mode === "late-cancel" ? "committed" : "cancelled");
  if (mode === "late-cancel") expect(terminal.atUs).toBeLessThan(r.events.find(v => v.kind === "caller-terminal")!.atUs);
});
test("bounded causal exhaustion reduces certainty without changing physics; prefixes replay read-only", () => {
  const full = run(), limited = run("overflow"), prefix = run("failure", 4);
  expect(limited.evidence.completeness.exactCausality).toBe(false); expect(limited.evidence.model.causal.rows).toHaveLength(2);
  expect(limited.evidence.model.counts).toEqual(full.evidence.model.counts); expect(limited.evidence.model.database).toEqual(full.evidence.model.database);
  expect(internalReport(limited.row).unknown.join(" ")).toContain("Exact request causality is Unknown");
  for (const r of [full, limited, prefix]) { const before = contentHash(r.row); expect(replayStored(r.row).kind).toBe("MatchesRecordedPrefix"); expect(contentHash(r.row)).toBe(before); }
  expect(replayStored(prefix.row).complete).toBe(false);
});
test("v1 stays v1; cross-version relabels, corrupted fingerprints and missing identities refuse", () => {
  const old = internalProductFixture(), input = compileEnvelope("old", "owner", old.layout, new Date(), old.request), r = instantiate(input); r.advanceTo(0); const oldCapture = capture(r, input, 1);
  expect(input.schema).toBe("infraforge-internal-execution/1"); expect(oldCapture.schema).toBe("infraforge-internal-evidence/1");
  const v2 = run(), corrupt = structuredClone(v2.evidence); corrupt.model.causal.rows[0]![1] = 99999;
  expect(() => readCapture(corrupt, v2.input.fingerprint)).toThrow();
  const { fingerprint: _fingerprint, ...body } = corrupt; corrupt.fingerprint = contentHash(body); expect(() => readCapture(corrupt, v2.input.fingerprint)).toThrow();
  const relabel = { ...v2.evidence, schema: "infraforge-internal-evidence/1" }; const { fingerprint: _old, ...relabeledBody } = relabel; relabel.fingerprint = contentHash(relabeledBody);
  expect(() => readCapture(relabel, v2.input.fingerprint)).toThrow();
  expect(() => readEnvelope({ ...v2.input, schema: input.schema }, v2.input.fingerprint)).toThrow();
});
test("resource/edge ordering and drawing coordinates cannot change compiled physics", () => {
  const f = connectedFixture(), original = compileEnvelope("run", "owner", f.layout, new Date(), f.request);
  f.layout.resources.reverse(); f.layout.connectionLines.reverse(); for (const r of f.layout.resources) { r.x += 999; r.y -= 111; }
  expect(compileEnvelope("run", "owner", f.layout, new Date(), f.request).compiledHash).toBe(original.compiledHash);
});
const negatives: Record<string, (f: ReturnType<typeof connectedFixture>) => void> = {
  topology: f => { f.layout.resources.pop(); }, backend: f => { delete (f.request.contract as any).edges["route-a"]; }, health: f => { delete (f.request.contract as any).nodes.lb.resources[0].config.health; }, demand: f => { (f.request.contract as any).application.demands = []; }, dependency: f => { delete (f.request.contract as any).nodes["app-a"].resources[0].config.downstream; }, query: f => { delete (f.request.contract as any).nodes.db.resources[0].config.plans.write; }, direction: f => { f.layout.connectionLines[0]!.sourceId = "db"; }, listener: f => { (f.request.contract as any).nodes.db.listeners = []; }, transport: f => { (f.request.contract as any).transports = {}; }, security: f => { (f.request.contract as any).caller.security.tls.mode = "tls"; }, provider: f => { Object.assign(f.layout.resources[0]!, { skuId: "legacy" }); }, autoscaling: f => { Object.assign(f.layout.resources[1]!, { autoscaling: { enabled: true } }); }, fault: f => { const fault = connectedFixture("failure"); (f.request.contract as any).faults = (fault.request.contract as any).faults; (f.request.contract as any).faults[0].target = "db"; }, provenance: f => { (f.request.contract as any).ledger = []; }, expansion: f => { (f.request.contract as any).nodes["app-a"].resources.push({ role: "extra", config: {} }); }, budget: f => { f.request.causal!.events = 513; }, version: f => { (f.request.contract as any).version = "unversioned"; }
};
for (const [name, change] of Object.entries(negatives)) test(`connected admission refuses ${name}`, () => { const f = connectedFixture(); change(f); expect(() => compileEnvelope("run", "owner", f.layout, new Date(), f.request)).toThrow(); });
