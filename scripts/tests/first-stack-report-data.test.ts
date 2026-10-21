import { expect, test } from "bun:test";
import { ResultBook } from "../../packages/simulation/src/model2/workload/evidence";
import { firstStackCompileFixture } from "../fixtures/first-stack-compile";
import { firstStackCacheFixture } from "../fixtures/first-stack-cache";
import { firstStackIoFixture } from "../fixtures/first-stack-io";
import { createFirstStackRuntime } from "../../packages/simulation/src/internalFirstStack";
import { captureReport } from "../../apps/backend/firstStack/reportCapture";
import { captureExecutionCut } from "../../apps/backend/firstStack/executionCut";
import { canonical } from "../../apps/backend/firstStack/canonical";
import { inputDigest, isolatedCut } from "../../apps/backend/firstStack/isolationProtocol";
import { firstStackReport, type FirstStackStoredReportRow } from "../../apps/backend/firstStack/report";
import { submissionFixture } from "../../apps/backend/tests/submissionFixture";
async function fixture() {
  const f = await submissionFixture(), cut = f.request.browserCut;
  const row: FirstStackStoredReportRow = { id: "report-test", input: f.input, inputHash: cut.inputHash, engine: f.engine, lock: f.lock,
    status: "terminal", browserCut: cut, durablePrefix: cut, result: null, resultHash: null,
    lineage: { infrastructureId: f.request.infrastructureId }, createdAt: new Date("2026-10-21T00:00:00Z") };
  return { row, cut };
}

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
  expect(JSON.stringify(captureReport(io, e).saturation.storage)).toBe(JSON.stringify(e.composition.storage));
  expect(captureReport(io, e).saturation.cpu).toEqual(e.composition.cpu);
});
