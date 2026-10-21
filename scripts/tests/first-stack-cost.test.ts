import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { providerFixture } from "../../packages/simulation/tests/providerFixture";
import { firstStackComputeCost, compareFirstStackCosts, type ComputeCostEvidence } from "../../apps/backend/firstStack/providerCost";
import { firstStackReport } from "../../apps/backend/firstStack/report";
import { firstStackRunRecord } from "../../apps/backend/runRecords/firstStack";
import { submissionFixture } from "../../apps/backend/tests/submissionFixture";
import { isolatedCut } from "../../apps/backend/firstStack/isolationProtocol";
import { captureReport } from "../../apps/backend/firstStack/reportCapture";
import { sourceHash } from "../../apps/backend/executionIdentity/hash";
import { boundedJson } from "../../packages/simulation/src/internalFirstStack";
import type { ReportJson } from "@infraforge/contracts/reports";

const throughUs = 120_000_000;
const topology = { nodes: [{ id: "app", host: "h", owner: "compute" }, { id: "db", host: "h", owner: "relational" }], placement: [{ id: "h" }] };
function fixture(durationUs = 1): ComputeCostEvidence {
  const tariff = providerFixture().snapshot.prices[0]!;
  return { schema: "first-stack-compute-cost/1", window: { from: "2026-10-16T06:00:00Z", to: "2026-10-16T06:02:00Z", complete: true },
    allocations: [{ id: "allocation", host: "h", scope: tariff.scope, tariff, provenance: ["Authored software test allocation; not observed EC2 usage"] }],
    events: [{ id: "start", allocation: "allocation", kind: "allocated", atUs: 0 }, { id: "stop", allocation: "allocation", kind: "terminated", atUs: durationUs }] };
}
const price = (e: unknown, graph: unknown = topology, through = throughUs, complete = true) => firstStackComputeCost(e, graph, through, complete);

test("explicit allocation boundaries bill once for shared-host roles with exact minimum and increment", () => {
  for (const [duration, numerator, denominator] of [[1, "1", "625"], [60_000_000, "1", "625"], [60_000_001, "61", "37500"]] as const) {
    const r = price(fixture(duration));
    expect(r.subtotal).toMatchObject({ kind: "Estimated", currency: "USD", amount: { numerator, denominator } });
    expect(r.covered).toHaveLength(1); expect(r.covered[0]?.roles).toEqual(["app", "db"]);
    expect(r.covered[0]?.quantity.numerator).toBe(String(duration));
    expect(r.covered[0]?.tariff).toMatchObject({ minimum: "60000000", increment: "1000000", aggregation: "session" });
    expect(r.fullCost.kind).toBe("Unknown"); expect(r.label).toBe("supported compute subtotal");
    for (const component of ["Load balancer", "Storage", "Backups", "Addresses", "Transfer", "Cache"]) expect(r.exclusions).toContain(component);
  }
});

test("separate terminated sessions receive separate minima while process crashes never create stops", () => {
  const e = fixture();
  e.allocations.push({ ...e.allocations[0]!, id: "next" });
  e.events.push({ id: "start2", allocation: "next", kind: "allocated", atUs: 2 }, { id: "stop2", allocation: "next", kind: "terminated", atUs: 3 });
  expect(price(e).subtotal).toMatchObject({ kind: "Estimated", amount: { numerator: "2", denominator: "625" } });
  e.events.pop(); expect(price(e).subtotal.kind).toBe("Unknown");
  const crash = fixture(); (crash.events[1] as { kind: string }).kind = "process-crashed";
  expect(price(crash).subtotal.kind).toBe("Unknown");
});

test("missing, duplicate and overlapping allocation usage are Unknown across tariffs and roles", () => {
  const edits: Array<(e: ComputeCostEvidence) => void> = [
    e => { e.events = []; }, e => { e.events.pop(); }, e => { e.allocations = []; },
    e => { e.events.push(e.events[0]!); }, e => { e.events.push({ ...e.events[0]!, id: "other" }); },
    e => { e.events.push({ ...e.events[1]!, id: "other" }); }, e => { e.allocations.push(e.allocations[0]!); },
    e => { e.events[0]!.allocation = "absent"; }, e => { e.events[0]!.atUs = 2; },
    e => { e.allocations.push({ ...e.allocations[0]!, id: "double" }); e.events.push(...e.events.map(x => ({ ...x, id: x.id + "2", allocation: "double" }))); },
  ];
  for (const edit of edits) { const e = fixture(); edit(e); const r = price(e); expect(r.subtotal.kind).toBe("Unknown"); expect(r.covered).toEqual([]); }
});

test("exact provider product location OS tenancy purchase and meter matching are required", () => {
  for (const field of ["provider", "service", "product", "region", "operatingSystem", "tenancy", "purchase"] as const) {
    const e = fixture(); e.allocations[0]!.scope = { ...e.allocations[0]!.scope, [field]: "unsupported" };
    expect(price(e).subtotal.kind).toBe("Unknown");
    if (field !== "region") { e.allocations[0]!.tariff!.scope = e.allocations[0]!.scope; expect(price(e).subtotal.kind).toBe("Unknown"); }
  }
  for (const edit of [(e: ComputeCostEvidence) => { e.allocations[0]!.tariff = null; },
    (e: ComputeCostEvidence) => { e.allocations[0]!.tariff!.provenance = "authored"; },
    (e: ComputeCostEvidence) => { e.allocations[0]!.tariff!.meter = "operations"; }]) {
    const e = fixture(); edit(e); expect(price(e).subtotal.kind).toBe("Unknown");
  }
});

test("expired tariff, incomplete window and out-of-window usage cannot be priced", () => {
  const e = fixture();
  expect(price(e, topology, throughUs, false).subtotal.kind).toBe("Unknown");
  e.window.complete = false; expect(price(e).subtotal.kind).toBe("Unknown"); e.window.complete = true;
  e.allocations[0]!.tariff!.validTo = e.window.from; expect(price(e).subtotal.kind).toBe("Unknown");
  const outside = fixture(throughUs + 1); expect(price(outside).subtotal.kind).toBe("Unknown");
  const short = fixture(); short.window.to = short.window.from; expect(price(short).subtotal.kind).toBe("Unknown");
  const validBoundary = fixture(throughUs); validBoundary.allocations[0]!.tariff!.validTo = validBoundary.window.to;
  expect(price(validBoundary).subtotal.kind).toBe("Estimated");
  validBoundary.window.to = "2026-10-16T06:02:00.001Z"; expect(price(validBoundary).subtotal.kind).toBe("Unknown");
});

test("mixed currency and unsupported billing rules stay Unknown without exchange or zero defaults", () => {
  const e = fixture();
  e.allocations.push({ ...e.allocations[0]!, id: "eur", host: "h2", tariff: { ...e.allocations[0]!.tariff!, currency: "EUR" } });
  e.events.push({ id: "eur-start", allocation: "eur", kind: "allocated", atUs: 0 }, { id: "eur-stop", allocation: "eur", kind: "terminated", atUs: 1 });
  expect(price(e, { nodes: [...topology.nodes, { id: "app2", host: "h2", owner: "compute" }], placement: [{ id: "h" }, { id: "h2" }] }).subtotal.kind).toBe("Unknown");
  for (const field of ["minimum", "increment", "per"] as const) { const bad = fixture(); bad.allocations[0]!.tariff![field] = "0"; expect(price(bad).subtotal.kind).toBe("Unknown"); }
});

test("relational/cache/LB icons and unknown hosts are never reinterpreted as provider compute", () => {
  for (const owner of ["relational", "keyed-cache", "load-balancer"]) expect(price(fixture(), { nodes: [{ id: "icon", host: "h", owner }], placement: [{ id: "h" }] }).subtotal.kind).toBe("Unknown");
  const e = fixture(); e.allocations[0]!.host = "absent"; expect(price(e).subtotal.kind).toBe("Unknown");
});

test("malformed and oversized evidence stays Unknown with no partial known charges", () => {
  for (const e of [undefined, null, {}, "bad", { ...fixture(), extra: true }, { ...fixture(), events: Array(100).fill(fixture().events[0]) },
    { ...fixture(), allocations: [{ ...fixture().allocations[0], provenance: ["x".repeat(65537)] }] }]) {
    const r = price(e); expect(r.subtotal.kind).toBe("Unknown"); expect(r.covered).toEqual([]); expect(r.fullCost.kind).toBe("Unknown");
  }
});

test("frozen cost selection survives cut, report, RunRecord JSON and comparison with its label", async () => {
  const f = await submissionFixture(), cut = f.request.browserCut, input = JSON.parse(f.input);
  const host = input.candidate.nodes.find((n: { owner: string }) => n.owner === "compute").host;
  const evidence = fixture(); evidence.allocations[0]!.host = host;
  evidence.window.to = "2026-10-16T06:00:00.090Z";
  const capture = { ...cut.cut.reportCapture!, computeCost: evidence as unknown as ReportJson };
  const row = { id: "cost-report", input: f.input, inputHash: cut.inputHash, engine: f.engine, lock: f.lock, status: "terminal",
    browserCut: cut, durablePrefix: isolatedCut({ ...cut.cut, reportCapture: capture }, cut.source, cut.inputHash), result: null, resultHash: null,
    lineage: { infrastructureId: f.request.infrastructureId }, createdAt: new Date("2026-10-21T00:00:00Z") };
  const report = firstStackReport(row), record = JSON.parse(JSON.stringify(firstStackRunRecord(row)));
  expect(report.origin).toBe("server"); expect(report.cost.subtotal.kind).toBe("Estimated");
  expect(record.evidence.report.cost).toEqual(report.cost);
  const legacy = firstStackReport({ ...row, durablePrefix: cut });
  expect(legacy.cost.subtotal.kind).toBe("Unknown");
  const compared = JSON.parse(JSON.stringify(compareFirstStackCosts(report.cost, legacy.cost)));
  expect(compared.label).toBe("supported compute subtotal"); expect(compared.left.label).toBe(compared.right.label);
  expect(compared.left.fullCost.kind).toBe("Unknown"); expect(compared.right.fullCost.kind).toBe("Unknown");
  expect(JSON.stringify(compared)).not.toContain("monthly");
  const browser = firstStackReport({ ...row, durablePrefix: null, browserCut: row.durablePrefix });
  expect(browser.origin).toBe("browser-untrusted"); expect(browser.cost.label).toBe(report.cost.label);
  const corrupt = firstStackReport({ ...row, durablePrefix: { ...row.durablePrefix, fingerprint: "bad" } });
  expect(corrupt.cost.subtotal.kind).toBe("Unknown");
  // The opaque optional cost field cannot corrupt unrelated historical data.
  const malformed = firstStackReport({ ...row, durablePrefix: isolatedCut({ ...cut.cut, reportCapture: { ...capture, computeCost: {} } }, cut.source, cut.inputHash) });
  expect(malformed.populations).not.toBeNull(); expect(malformed.cost.subtotal.kind).toBe("Unknown");
});

test("bounded diagnostic fallback omits over-budget cost evidence", async () => {
  const { firstStackCompileFixture } = await import("../fixtures/first-stack-compile");
  const { instantiatePreparedFirstStack } = await import("../../apps/backend/firstStack/execution");
  const f = await firstStackCompileFixture(), runtime = instantiatePreparedFirstStack(f.prepare());
  runtime.advanceTo(runtime.horizon);
  const capture = captureReport(runtime, runtime.evidence(), "x".repeat(300_000));
  expect(capture.computeCost).toBeUndefined(); expect(capture.unknown.length).toBeGreaterThan(0);
  expect(() => boundedJson(capture, 256 * 1024)).not.toThrow();
});

test("cost source review pins the adapter, additive contract and acceptance", () => {
  const review = JSON.parse(readFileSync("docs/reality/first-stack-cost-source-review.json", "utf8"));
  expect(review.schema).toBe("first-stack-cost-source-review/1"); expect(review.files).toHaveLength(6); expect(review.acceptance).toHaveLength(1);
  for (const row of [...review.files, ...review.acceptance]) expect(sourceHash(readFileSync(row.path, "utf8"))).toBe(row.hash);
});
