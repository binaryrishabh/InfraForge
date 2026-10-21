import { expect, test } from "bun:test";
import type { FirstStackReportCapture } from "@infraforge/contracts/reports";
import { firstStackReport, type FirstStackStoredReportRow } from "../firstStack/report";
import { firstStackRunRecord } from "../runRecords/firstStack";
import { hash } from "../firstStack/canonical";
import { isolatedCut, readIsolatedCut } from "../firstStack/isolationProtocol";
import { submissionFixture } from "./submissionFixture";
import { ResultBook } from "../../../packages/simulation/src/model2/workload/evidence";
import { firstStackCompileFixture } from "../../../scripts/fixtures/first-stack-compile";
import { firstStackCacheFixture } from "../../../scripts/fixtures/first-stack-cache";
import { firstStackIoFixture } from "../../../scripts/fixtures/first-stack-io";
import { createFirstStackRuntime } from "@infraforge/simulation/internal-first-stack";
import { captureReport } from "../firstStack/reportCapture";
import { captureExecutionCut } from "../firstStack/executionCut";
import { canonical } from "../firstStack/canonical";
import { inputDigest } from "../firstStack/isolationProtocol";

async function fixture() {
  const f = await submissionFixture(), cut = f.request.browserCut;
  const row: FirstStackStoredReportRow = { id: "report-test", input: f.input, inputHash: cut.inputHash, engine: f.engine, lock: f.lock,
    status: "terminal", browserCut: cut, durablePrefix: cut, result: null, resultHash: null,
    lineage: { infrastructureId: f.request.infrastructureId }, createdAt: new Date("2026-10-21T00:00:00Z") };
  return { row, cut };
}
test("a real server capture projects through RunRecord with evidence-backed lifecycle links", async () => {
  const { row } = await fixture(), r = firstStackReport(row), record = firstStackRunRecord(row);
  expect(r.origin).toBe("server"); expect(r.populations?.counts.offered).toBe(1);
  expect(r.latency[0]?.percentiles.every(t => t.kind === "unknown")).toBe(true);
  expect(r.saturation?.cpu).toBeArray(); expect(r.saturation?.data).toBeObject();
  expect(r.causality.links.length).toBeGreaterThan(0);
  for (const link of r.causality.links) for (const id of link.evidence) expect(r.causality.events.some(e => e.id === id)).toBe(true);
  expect(record.schema).toBe("infraforge-run-record/1"); expect(record.engine.lineage).toBe("2");
  expect(record.evidence.reportSchema).toBe(r.schema); expect(record.evidence.report).toEqual(r);
  expect(record.evidence.unknown.join(" ")).toContain("full resident memory");
});

test("exact and bounded tails preserve ranks and never substitute histogram midpoints", async () => {
  const { row, cut } = await fixture();
  for (const rawLimit of [100, 0]) {
    const book = new ResultBook(rawLimit);
    for (let i = 1; i <= 100; i++) book.record({ rootId: `test-${i}`, callId: `test-${i}`, attempt: 0, operation: "read", offeredAt: 0, at: i, responseUs: i, outcome: "completed" });
    const updated = { ...cut.cut, counts: { ...cut.cut.counts, offered: 100, completed: 100, inFlight: 0 }, distributions: { population: "terminal test cohort", censored: 0, groups: book.summary() } };
    const report = firstStackReport({ ...row, durablePrefix: isolatedCut(updated, cut.source, cut.inputHash) });
    expect(report.origin).toBe("server");
    const tails = report.latency[0]!.percentiles;
    expect(tails.map(t => t.kind)).toEqual(Array(3).fill(rawLimit ? "exact" : "bounded"));
    if (tails[2]?.kind === "exact") expect(tails[2].valueUs).toBe(99);
    if (tails[2]?.kind === "bounded") { expect(tails[2].minUs).toBe(64); expect(tails[2].maxUs).toBe(127); expect("valueUs" in tails[2]).toBe(false); }
  }
});

test("insufficient tail ranks use the 2/20/100 computational minima", async () => {
  const { row, cut } = await fixture();
  for (const n of [1, 2, 19, 20, 99, 100]) {
    const book = new ResultBook(n);
    for (let i = 0; i < n; i++) book.record({ rootId: "test", callId: `${i}`, attempt: 0, operation: "read", offeredAt: 0, at: 1, responseUs: 1, outcome: "completed" });
    const report = firstStackReport({ ...row, durablePrefix: isolatedCut({ ...cut.cut, counts: { ...cut.cut.counts, offered: n, completed: n }, distributions: { population: "test", censored: 0, groups: book.summary() } }, cut.source, cut.inputHash) });
    expect(report.latency[0]!.percentiles.map(t => t.kind)).toEqual([2, 20, 100].map(min => n >= min ? "exact" : "unknown"));
  }
});

test("truncated causes do not invalidate complete aggregates; censored callers stay unfinished", async () => {
  const { row, cut } = await fixture();
  const updated = { ...cut.cut, counts: { ...cut.cut.counts, offered: 2, inFlight: 1 }, unfinished: { ...cut.cut.unfinished, callers: 1 },
    distributions: { ...(cut.cut.distributions as object), censored: 1 },
    completeness: { ...cut.cut.completeness, allRootsTerminal: false, journalComplete: false },
    reportCapture: { ...cut.cut.reportCapture!, selection: { ...cut.cut.reportCapture!.selection, journalOmitted: 9 } } };
  const r = firstStackReport({ ...row, durablePrefix: isolatedCut(updated, cut.source, cut.inputHash) });
  expect(r.populations?.counts.inFlight).toBe(1); expect(r.latency[0]?.count).toBe(1);
  expect(r.causality.complete).toBe(false); expect(r.causality.omitted).toBeGreaterThanOrEqual(9);
  expect(r.unknown.join(" ")).toContain("right-censored");
});

test("caller timeout and later remote commit remain separate retained facts", async () => {
  const { row, cut } = await fixture(), rootId = '["root","recorded","timeout"]';
  const capture: FirstStackReportCapture = { ...cut.cut.reportCapture!, events: [
    { id: "journal:0", atUs: 10, kind: "caller-terminal", resource: "$caller", work: { rootId, callId: "caller", attempt: 0, operation: "write", offeredAt: 0 }, detail: { outcome: "deadline-exceeded" } },
    { id: "journal:1", atUs: 20, kind: "db-terminal", resource: "db", work: { rootId, callId: "db-child", parentCallId: "caller", attempt: 0, operation: "write", offeredAt: 0 }, detail: { outcome: "committed", writes: 1 } },
  ], selection: { roots: [rootId], omitted: 0, journalOmitted: 0, policy: "first-3-roots-and-global/1" } };
  const r = firstStackReport({ ...row, durablePrefix: isolatedCut({ ...cut.cut, reportCapture: capture }, cut.source, cut.inputHash) });
  expect(r.failureTimeline[0]?.kind).toBe("caller-terminal");
  expect(r.causality.events[1]?.detail.outcome).toBe("committed");
  expect(r.causality.links.every(l => l.evidence.length === 2)).toBe(true);
});

test("missing, corrupt, wrong-identity and legacy captures produce explicit Unknown", async () => {
  const { row, cut } = await fixture();
  for (const edit of [{ durablePrefix: {}, browserCut: null }, { input: "{}" }, { durablePrefix: { ...cut, fingerprint: "f".repeat(64) } },
    { durablePrefix: isolatedCut({ ...cut.cut, counts: {} }, cut.source, cut.inputHash) }, { result: { verification: "verified" }, resultHash: "bad" }]) {
    const r = firstStackReport({ ...row, ...edit });
    expect(r.origin).toBe("unavailable"); expect(r.populations).toBeNull(); expect(r.latency).toEqual([]); expect(r.unknown.length).toBeGreaterThan(1);
  }
  const { reportCapture: _capture, ...old } = cut.cut;
  const legacy = isolatedCut(old, cut.source, cut.inputHash);
  expect(readIsolatedCut(legacy, cut.source, cut.inputHash)).toEqual(legacy);
  const r = firstStackReport({ ...row, durablePrefix: legacy });
  expect(r.populations).not.toBeNull(); expect(r.saturation).toBeNull(); expect(r.unknown.join(" ")).toContain("Historical cut");
});

test("server verification result is hash checked and never inherited from the browser", async () => {
  const { row, cut } = await fixture();
  for (const status of ["unverified", "verified", "mismatch", "interrupted", "cancelled", "unavailable"] as const) {
    const result = { verification: status, actual: cut.fingerprint };
    expect(firstStackReport({ ...row, result, resultHash: hash(result) }).verification.status).toBe(status);
  }
  const result = { verification: "verified", actual: cut.fingerprint };
  expect(firstStackReport({ ...row, durablePrefix: null, result, resultHash: hash(result) }).verification.status).toBe("unknown");
  expect(firstStackReport({ ...row, durablePrefix: null }).origin).toBe("browser-untrusted");
  const mutated = { ...cut.cut, reportCapture: { ...cut.cut.reportCapture!, unknown: ["mutated"] } };
  expect(() => readIsolatedCut({ ...cut, cut: mutated }, cut.source, cut.inputHash)).toThrow("fingerprint");
});

test("one and multiple app identities survive capture without a Model 1 metric fallback", async () => {
  const records = [];
  const { row, cut } = await fixture();
  for (const apps of [1, 2]) {
    const f = await firstStackCompileFixture(apps), runtime = createFirstStackRuntime(f.sidecar, f.schedule, f.policy);
    runtime.advanceTo(runtime.horizon);
    const input = canonical({ owner: "qualification", candidate: f.sidecar, layout: f.layout, recording: f.schedule, policy: f.policy });
    const prepared = f.prepare();
    const captured = captureExecutionCut(prepared, runtime, 1, cut.cut.effectiveLimits, null).value;
    const report = firstStackReport({ ...row, input, inputHash: inputDigest(input), lock: prepared.lock,
      durablePrefix: isolatedCut(captured, cut.source, inputDigest(input)) });
    expect(report.origin).toBe("server"); expect(report.populations?.counts.offered).toBe(24);
    expect((report.identity.topology as { nodes: unknown[] }).nodes).toHaveLength(apps + 2);
    expect(JSON.stringify(report)).not.toContain("overallHealth"); records.push(report);
  }
  expect(records[0]!.identity.lock).not.toEqual(records[1]!.identity.lock);
});

test("merged cache and finite IO aggregate owners are retained without keyed state", async () => {
  const c = await firstStackCacheFixture(), cache = createFirstStackRuntime(c.sidecar, c.schedule, c.policy);
  cache.advanceTo(cache.horizon);
  const cacheEvidence = cache.evidence(), capture = captureReport(cache, cacheEvidence);
  const data = capture.saturation.data as { caches: Array<{ hits: number; misses: number; entries?: unknown }> };
  expect(data.caches[0]?.hits).toBe(cacheEvidence.data.caches[0]!.hits);
  expect(data.caches[0]?.misses).toBe(cacheEvidence.data.caches[0]!.misses);
  expect(data.caches[0]?.entries).toBeUndefined();
  const f = await firstStackIoFixture(), io = createFirstStackRuntime(f.sidecar, f.schedule, f.policy, undefined, f.profile);
  io.advanceTo(io.horizon);
  const e = io.evidence();
  expect(captureReport(io, e).saturation.storage).toEqual(e.composition.storage!);
  expect(captureReport(io, e).saturation.cpu).toEqual(e.composition.cpu);
});
