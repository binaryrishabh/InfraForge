import { expect, test } from "bun:test";
import { historicalRunRecord } from "../runRecords/historical";
import { readRunRecord } from "../runRecords/schema";
import { buildRunReport, type StoredRun } from "../reports/report";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRerunOptions } from "../reruns/options";
import { improvementSource } from "../challenges/improvements";
import { layout, workload } from "./integration/scenario";
import { internalProductFixture } from "./model2Fixture";
import { connectedFixture } from "./connectedFixture";
import { compileEnvelope, captureCuts } from "../internalModel2/envelope";
import { instantiate, capture } from "../internalModel2/capture";
import { replayStored } from "../internalModel2/report";
import type { InternalRunRow } from "../internalModel2/store";
import { submissionFixture } from "./submissionFixture";
import { historicalReplayTarget, ownedReplayRow, type HistoricalReplayRow } from "../firstStack/historicalReplay";
import { isolationPolicyHash, qualificationChecks } from "../firstStack/isolationPolicy";
import type { SubmissionVerifier } from "../firstStack/submissionWorker";
import { prepareFirstStackExecution, instantiatePreparedFirstStack } from "../firstStack/execution";
import { captureExecutionCut } from "../firstStack/executionCut";
import { replayFirstStackPrefix } from "../firstStack/isolationReplay";
import { hash } from "../firstStack/canonical";
import { isolatedCut } from "../firstStack/isolationProtocol";
import { migrationSource } from "../firstStack/migration";
import express from "express";
import { createSubmissionRouter } from "../firstStack/submissionRoutes";
import { errorHandler } from "../utils/middleware";

const at = new Date("2026-10-21T00:00:00Z");
function model1(runInputs: unknown): StoredRun {
  return { id: "m1", infrastructureId: "design", status: "completed", resourceCount: 0, createdAt: at, updatedAt: at,
    topologyRevision: 0, stages: [], timeline: [], chaosEvents: [], workloadProfile: workload, seed: null,
    simulationState: { simulatedSeconds: 10, overallHealth: "healthy" }, runInputs, liveTopology: null };
}
test("M1 V1/V2, absent provenance and unsupported inputs stay readable under retirement without execution", () => {
  const v2 = captureRunInputs(layout, workload), { simulationModelVersion: _model, catalogSnapshot: _catalog, ...old } = v2;
  for (const input of [v2, { ...old, version: 1 }, { ...old, version: 2 }, null, { version: 99 }]) {
    const row = model1(input), before = structuredClone(row), original = buildRunReport(row);
    const record = historicalRunRecord({ store: "Deployment", row }, { model1Retired: true });
    expect(record.evidence.report).toEqual(original); expect(record.availability?.execution).toBe("execution-retired");
    expect(record.availability?.replay).toBe("unavailable"); expect(record.reference).toEqual({ engine: "1", store: "Deployment", id: "m1" });
    expect(buildRerunOptions(row, layout, { model1Retired: true }).exact.available).toBe(false);
    expect(buildRerunOptions(row, layout, { model1Retired: true }).currentDesign.available).toBe(false);
    expect(() => improvementSource(row, "old-challenge", { model1Retired: true })).toThrow("Execution retired");
    expect(row).toEqual(before);
  }
  expect(historicalRunRecord({ store: "Deployment", row: model1({ version: 2 }) }).engine.version).toBeNull();
  expect(() => historicalRunRecord({ store: "unknown", row: {} } as any)).toThrow("Unsupported");
});

for (const version of [1, 2] as const) test(`internal M2 v${version} dispatch reads and replays only its durable prefix`, () => {
  const f = version === 1 ? internalProductFixture() : connectedFixture();
  const input = compileEnvelope("internal-history", "owner", f.layout, at, f.request), runtime = instantiate(input);
  let evidence: ReturnType<typeof capture> | undefined;
  for (const cut of captureCuts(input).slice(0, 4)) { runtime.advanceTo(cut); evidence = capture(runtime, input, (evidence?.sequence ?? 0) + 1, evidence?.checkpoints); }
  const row: InternalRunRow = { id: input.runId, ownerId: input.ownerId, infrastructureId: input.infrastructureId, input, inputHash: input.fingerprint,
    evidence: evidence!, sequence: evidence!.sequence, throughUs: evidence!.throughUs, status: "interrupted", reason: "Retained prefix", token: null,
    requestHash: "0".repeat(64), idempotencyKey: "history", cancelRequested: false, createdAt: at, updatedAt: at };
  const before = structuredClone(row), record = historicalRunRecord({ store: "InternalModel2Run", row });
  expect(record.evidence.reportSchema).toBe(`infraforge-internal-report/${version}`);
  expect(record.experiment.input).toEqual(input); expect(replayStored(row)).toMatchObject({ kind: "MatchesRecordedPrefix", throughUs: row.throughUs, complete: false });
  expect(row).toEqual(before);
  const corrupt = historicalRunRecord({ store: "InternalModel2Run", row: { ...row, input: { schema: "unknown/99" } } });
  expect(corrupt.experiment.input).toBeNull(); expect(corrupt.availability?.replay).toBe("unavailable");
  expect(corrupt.evidence.unknown.join(" ")).toContain("Unsupported historical input version");
});

async function firstStack() {
  const f = await submissionFixture(), cut = f.request.browserCut;
  const row: HistoricalReplayRow = { id: "history", ownerId: f.owner, authorized: true, engine: f.engine, input: f.input, inputHash: cut.inputHash,
    lock: f.lock, status: "terminal", browserCut: cut, durablePrefix: cut, result: null, resultHash: null,
    lineage: { infrastructureId: f.request.infrastructureId }, createdAt: at };
  const configuration = { admission: { enabled: false, engine: null }, control: { identity: "c".repeat(64) }, isolation: { ...f.engine,
    qualification: { schema: "first-stack-host/1", target: "laptop-desktop", ...f.engine, daemon: "c".repeat(64), policy: isolationPolicyHash,
      checkedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), capacity: 1, qualified: true,
      checks: Object.fromEntries(qualificationChecks.map(key => [key, true])) } } } as SubmissionVerifier;
  return { f, row, cut, configuration };
}
test("first-stack history preserves verification, slice-12 report capture and typed migration separately from physics", async () => {
  const { row, cut } = await firstStack(), source = { engine: "1", store: "Deployment", id: "old-run" } as const;
  const result = { verification: "verified", actual: cut.fingerprint }, stored = { ...row, result, resultHash: hash(result), lineage: { ...row.lineage, migratedFrom: source } };
  const record = historicalRunRecord({ store: "FirstStackRun", row: stored });
  expect(record.lineage).toEqual({ kind: "migrated-from", source }); expect(record.engine.lineage).toBe("2"); expect(record.id).not.toBe(source.id);
  expect((record.evidence.report as any).verification.status).toBe("verified"); expect((record.evidence.report as any).saturation).not.toBeNull();
  expect(record.experiment.input).toEqual(JSON.parse(row.input)); expect(JSON.stringify(record.experiment.input)).not.toContain("migratedFrom");
  expect(() => readRunRecord({ ...record, reference: { engine: "1", store: "FirstStackRun", id: "bad" } })).toThrow();
  expect(() => readRunRecord({ ...record, evidence: { ...record.evidence, reportSchema: "infraforge-first-stack-report/99" } })).toThrow("Unsupported historical");
  const { reportCapture: _capture, ...old } = cut.cut;
  const legacy = historicalRunRecord({ store: "FirstStackRun", row: { ...row, durablePrefix: isolatedCut(old, cut.source, cut.inputHash) } });
  expect((legacy.evidence.report as any).populations).not.toBeNull(); expect(legacy.evidence.unknown.join(" ")).toContain("Historical cut");
  for (const edit of [{ input: "{}" }, { durablePrefix: { ...cut, schema: "unknown/99" } }, { result: { verification: "new/99" }, resultHash: "bad" }]) {
    const corrupt = historicalRunRecord({ store: "FirstStackRun", row: { ...row, ...edit } });
    expect(corrupt.availability?.report).toBe("unavailable"); expect(corrupt.availability?.replay).toBe("unavailable");
  }
});
test("historical report HTTP reads remain available with new admission disabled and never request replay", async () => {
  const { row } = await firstStack();
  const pool: any = { query: async (_sql: string, values: string[]) => ({ rows: values[1] === row.ownerId ? [row] : [] }) };
  const app = express(); app.use((_req, res, next) => { res.locals.userId = row.ownerId; next(); });
  app.use(createSubmissionRouter(pool)); app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1"), address = server.address() as any;
  const id = "00000000-0000-4000-8000-000000000024";
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/${id}`);
    expect(response.status).toBe(200); expect((await response.json() as any).evidence.report.origin).toBe("server");
    expect((await fetch(`http://127.0.0.1:${address.port}/${id}/replays`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(404);
  } finally { server.closeAllConnections(); await new Promise<void>(yes => server.close(() => yes())); }
});
test("owned historical replay requires exact source/image, qualified host, valid lock and durable server evidence", async () => {
  const { row, cut, configuration } = await firstStack();
  expect(historicalReplayTarget(row, configuration)).toEqual(cut);
  for (const edit of [{ authorized: false }, { status: "running" }, { durablePrefix: null }, { input: "{}" }, { lock: {} },
    { engine: { ...row.engine, source: "d".repeat(64) } }, { engine: { ...row.engine, image: `sha256:${"d".repeat(64)}` } }]) {
    expect(() => historicalReplayTarget({ ...row, ...edit }, configuration)).toThrow();
  }
  expect(() => historicalReplayTarget(row, { ...configuration, isolation: { ...configuration.isolation, qualification: null } })).toThrow("unqualified");
  await expect(ownedReplayRow({ query: async () => ({ rows: [] }) } as any, "other", row.id)).rejects.toThrow("Resource");
});
test("first-stack prefix replay stops at recorded event count, yields bounded mismatch diagnostics and never mutates input", async () => {
  const { f, row, cut } = await firstStack(), input = JSON.parse(f.input);
  const prepared = prepareFirstStackExecution(f.owner, input.layout, input.candidate, input.recording, input.policy);
  const runtime = instantiatePreparedFirstStack(prepared); runtime.advanceSlice(runtime.horizon, 3);
  const prefix = isolatedCut(captureExecutionCut(prepared, runtime, 1, cut.cut.effectiveLimits, null).value, cut.source, cut.inputHash);
  const before = structuredClone(prefix);
  expect(await replayFirstStackPrefix(prepared, prefix, cut.source, cut.inputHash)).toMatchObject({ kind: "MatchesRecordedPrefix", processed: 3, complete: false });
  expect(await replayFirstStackPrefix(prepared, cut, cut.source, row.inputHash)).toMatchObject({ kind: "MatchesRecordedPrefix", complete: true });
  const changed = isolatedCut({ ...prefix.cut, counts: { ...prefix.cut.counts, completed: 999 } }, cut.source, cut.inputHash);
  expect(await replayFirstStackPrefix(prepared, changed, cut.source, row.inputHash)).toMatchObject({ kind: "Mismatch", diagnostics: ["counts"] });
  const wrongLock = isolatedCut({ ...prefix.cut, lock: { ...prefix.cut.lock, compiledHash: "f".repeat(64) } }, cut.source, cut.inputHash);
  await expect(replayFirstStackPrefix(prepared, wrongLock, cut.source, row.inputHash)).rejects.toThrow("no latest-input");
  expect(prefix).toEqual(before);
});
test("migration links only an owned source run to its reviewed design copy", async () => {
  const source = { engine: "1", store: "Deployment", id: "00000000-0000-4000-8000-000000000001" } as const;
  const db: any = { query: async () => ({ rows: [{ id: source.id, infrastructureId: "original" }] }) };
  const copy = { firstStack: { migration: { kind: "reviewed-copy", fromInfrastructureId: "original", reviewedBy: "owner" } } };
  expect(await migrationSource(db, "owner", source, copy)).toEqual(source);
  for (const invalid of [{}, { firstStack: { migration: { ...copy.firstStack.migration, reviewedBy: "other" } } }]) await expect(migrationSource(db, "owner", source, invalid)).rejects.toThrow("reviewed");
  await expect(migrationSource({ query: async () => ({ rows: [] }) } as any, "owner", source, copy)).rejects.toThrow("unavailable");
});
