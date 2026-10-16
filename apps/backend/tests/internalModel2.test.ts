import { expect, test } from "bun:test";
import { internalProductFixture } from "./model2Fixture";
import { compileEnvelope, readEnvelope, captureCuts } from "../internalModel2/envelope";
import { contentHash } from "../internalModel2/identity";
import { instantiate, capture } from "../internalModel2/capture";
import type { StoredCapture } from "../internalModel2/capture";
import { internalReport, replayStored, reportHtml } from "../internalModel2/report";
import type { InternalRunRow } from "../internalModel2/store";
const compile = () => { const f = internalProductFixture(); return compileEnvelope("00000000-0000-4000-8000-000000000002", "authored-owner", f.layout, new Date(f.request.expectedDesignUpdatedAt), f.request); };
test("internal product compiles explicit saved design and recorded workload and retains exact downstream usage", () => {
  const input = compile(), runtime = instantiate(input); let evidence: StoredCapture | undefined;
  for (const at of captureCuts(input)) { runtime.advanceTo(at); evidence = capture(runtime, input, (evidence?.sequence ?? 0) + 1, evidence?.checkpoints); }
  expect(evidence!.model.capture.reachedHorizon).toBe(true);
  if (evidence!.schema !== "infraforge-internal-evidence/1") throw Error("Expected v1 object evidence");
  expect(evidence!.usage.snapshot.complete).toBe(true);
  expect(evidence!.model.objects[0]!.objects).toEqual([{ namespace: "n", key: "retained", generation: 3, bytes: 7, content: "retained" }]);
  expect(evidence!.model.commands.results.find((r) => r.id === "after-recovery")!.reply).toMatchObject({ ok: true, object: { bytes: 20, content: "second" } });
  expect(evidence!.checkpoints.find((c) => c.atUs === 5000)!.endpoints.objects).toMatchObject({ alive: false, ready: false });
  expect(evidence!.checkpoints.find((c) => c.atUs === 9000)!.endpoints.objects).toMatchObject({ alive: true, ready: true });
  expect(evidence!.usage.snapshot.measurements.find((m) => m.family === "object-store")).toMatchObject({ storedBytes: "7", byteUs: "264472", generation: 3 });
  expect(readEnvelope(input, input.fingerprint)).toEqual(input);
});
test("incomplete contracts, unsupported saved controls and budgets are refused before durable admission", () => {
  for (const change of ["profile", "resource", "control", "budget"] as const) {
    const f = internalProductFixture();
    if (change === "profile") delete f.request.contract.application;
    if (change === "resource") f.layout.resources[1]!.type = "Database" as "Object Storage";
    if (change === "control") Object.assign(f.layout.resources[0]!, { autoscaling: { enabled: true } });
    if (change === "budget") f.request.contract.limits.maxEvents = 10001;
    expect(() => compileEnvelope("run", "owner", f.layout, new Date(), f.request)).toThrow();
  }
});
test("input corruption and changed historical execution source never silently recompile", () => {
  const input = compile(), corrupt = structuredClone(input); corrupt.contract.seed += "changed";
  expect(() => readEnvelope(corrupt, corrupt.fingerprint)).toThrow("corrupt");
  const changed = structuredClone(input); changed.source = "0".repeat(64); const { fingerprint, ...body } = changed; void fingerprint; changed.fingerprint = contentHash(body);
  expect(() => readEnvelope(changed, changed.fingerprint)).toThrow("incompatible");
  expect(readEnvelope(changed, changed.fingerprint, false).source).toBe(changed.source);
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
  expect(readEnvelope(JSON.parse(JSON.stringify(reorder(input))), input.fingerprint)).toEqual(input);
});

function recorded() {
  const input = compile(), runtime = instantiate(input); let evidence: StoredCapture | undefined;
  for (const at of captureCuts(input)) { runtime.advanceTo(at); evidence = capture(runtime, input, (evidence?.sequence ?? 0) + 1, evidence?.checkpoints); }
  const row: InternalRunRow = { id: input.runId, ownerId: input.ownerId, infrastructureId: input.infrastructureId, idempotencyKey: "authored-report", requestHash: "0".repeat(64), token: "authored-token", cancelRequested: false,
    createdAt: new Date("2026-10-16T00:00:00Z"), updatedAt: new Date("2026-10-16T00:00:00Z"), input, inputHash: input.fingerprint, evidence: evidence!, sequence: evidence!.sequence, throughUs: evidence!.throughUs, status: "completed", reason: null };
  return { input, evidence: evidence!, row };
}
test("stored report and read-only prefix replay reconstruct the exact captured content", () => {
  const f = recorded(), before = structuredClone(f.row);
  expect(internalReport(f.row).problems).toEqual([]);
  expect(replayStored(f.row)).toMatchObject({ kind: "MatchesRecordedPrefix", complete: true });
  expect(f.row).toEqual(before);
  const html = reportHtml({ ...internalReport(f.row), reason: "</pre><script>untrusted()</script>" });
  expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("checkpoints");
});
test("missing/corrupt inputs, evidence gaps and incomplete usage cannot become observed totals", () => {
  const f = recorded();
  expect(internalReport({ ...f.row, input: {} }).observed).toEqual([]);
  expect(internalReport({ ...f.row, evidence: {} }).state).toBeNull();
  expect(internalReport({ ...f.row, sequence: f.row.sequence - 1 }).problems.join(" ")).toContain("gap");
  expect(() => replayStored({ ...f.row, sequence: f.row.sequence - 1 })).toThrow("gap");
  const incomplete = structuredClone(f.evidence); incomplete.usage.snapshot.complete = false; incomplete.usage.snapshot.reasons = ["Evidence was omitted"];
  const { fingerprint, ...body } = incomplete; void fingerprint; incomplete.fingerprint = contentHash(body);
  expect(internalReport({ ...f.row, evidence: incomplete }).usage).toMatchObject({ kind: "Unknown", measurements: [] });
});

test("a historical source mismatch preserves stored reporting but refuses current execution", () => {
  const f = recorded(), input = structuredClone(f.input); input.source = "f".repeat(64);
  const { fingerprint, ...body } = input; void fingerprint; input.fingerprint = contentHash(body);
  const evidence = structuredClone(f.evidence); evidence.input = input.fingerprint; evidence.source = input.source;
  const { fingerprint: oldEvidence, ...evidenceBody } = evidence; void oldEvidence; evidence.fingerprint = contentHash(evidenceBody);
  const row = { ...f.row, input, inputHash: input.fingerprint, evidence };
  const report = internalReport(row);
  expect(report.replay.compatible).toBe(false); expect(report.observed).toEqual(internalReport(f.row).observed);
  expect(() => replayStored(row)).toThrow("incompatible");
});
