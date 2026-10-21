import { expect, test } from "bun:test";
import type { FirstStackReportCapture } from "@infraforge/contracts/reports";
import { firstStackReport, type FirstStackStoredReportRow } from "../firstStack/report";
import { firstStackRunRecord } from "../runRecords/firstStack";
import { hash } from "../firstStack/canonical";
import { isolatedCut, readIsolatedCut } from "../firstStack/isolationProtocol";
import { submissionFixture } from "./submissionFixture";

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
