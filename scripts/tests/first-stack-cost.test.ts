import { historicalSlice } from "../historical-slice-reviews";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { FirstStackAllocationUsage } from "@infraforge/contracts/reports";
import { providerFixture } from "../../packages/simulation/tests/providerFixture";
import { firstStackComputeCost, compareFirstStackCosts, type ComputeTariffSelection } from "../../apps/backend/firstStack/providerCost";
import { firstStackReport } from "../../apps/backend/firstStack/report";
import { firstStackRunRecord } from "../../apps/backend/runRecords/firstStack";
import { submissionFixture } from "../../apps/backend/tests/submissionFixture";
import { isolatedCut } from "../../apps/backend/firstStack/isolationProtocol";
import { hash } from "../../apps/backend/firstStack/canonical";
import { sourceHash } from "../../apps/backend/executionIdentity/hash";
import { prepareFirstStackExecution } from "../../apps/backend/firstStack/execution";
import { replayFirstStackPrefix } from "../../apps/backend/firstStack/isolationReplay";

const topology = { nodes: [{ id: "app", host: "h", owner: "compute" }, { id: "db", host: "h", owner: "relational" }], placement: [{ id: "h" }] };
function fixture(durationUs = 1) {
  const tariff = providerFixture().snapshot.prices[0]!;
  const selection: ComputeTariffSelection = { schema: "first-stack-compute-tariffs/1",
    window: { from: "2026-10-16T06:00:00Z", to: new Date(Date.parse("2026-10-16T06:00:00Z") + Math.ceil(durationUs / 1000)).toISOString(), complete: true },
    allocations: [{ id: "h", host: "h", scope: tariff.scope, tariff, provenance: ["Server-selected frozen software test quote; no observed EC2 usage"] }] };
  const usage: FirstStackAllocationUsage = { schema: "first-stack-allocation-usage/1", basis: "modeled-fixed-host-window/1", fromUs: 0, throughUs: durationUs,
    timestampComplete: true, allocations: [{ id: "h", host: "h", fromUs: 0, toUs: durationUs, instanceUs: durationUs }] };
  return { selection, usage };
}
const price = (f: ReturnType<typeof fixture>, graph: unknown = topology) => firstStackComputeCost(f.selection, f.usage, graph, f.usage.throughUs, true);

test("verified fixed host occupancy bills once for shared roles with exact minimum and increment", () => {
  for (const [duration, numerator, denominator] of [[1, "1", "625"], [60_000_000, "1", "625"], [60_000_001, "61", "37500"]] as const) {
    const r = price(fixture(duration));
    expect(r.subtotal).toMatchObject({ kind: "Estimated", currency: "USD", amount: { numerator, denominator } });
    expect(r.covered).toHaveLength(1); expect(r.covered[0]?.roles).toEqual(["app", "db"]);
    expect(r.covered[0]?.quantity.numerator).toBe(String(duration));
    expect(r.covered[0]?.tariff).toMatchObject({ minimum: "60000000", increment: "1000000", aggregation: "session" });
    expect(r.fullCost.kind).toBe("Unknown"); expect(r.label).toBe("supported compute subtotal");
  }
});

test("missing, duplicate, overlapping, inconsistent and mismatched usage remains Unknown", () => {
  const edits: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.usage.allocations = []; }, f => { f.selection.allocations = []; },
    f => { f.usage.allocations.push(f.usage.allocations[0]!); }, f => { f.selection.allocations.push(f.selection.allocations[0]!); },
    f => { f.usage.allocations.push({ ...f.usage.allocations[0]!, id: "double" }); },
    f => { f.usage.allocations[0]!.id = "absent"; }, f => { f.usage.allocations[0]!.fromUs = 1; },
    f => { f.usage.allocations[0]!.instanceUs = 0; }, f => { f.usage.allocations[0]!.toUs = 2; },
    f => { f.usage.timestampComplete = false; }, f => { f.selection.window.complete = false; },
  ];
  for (const edit of edits) { const f = fixture(); edit(f); const r = price(f); expect(r.subtotal.kind).toBe("Unknown"); expect(r.covered).toEqual([]); }
  const f = fixture(); expect(firstStackComputeCost(f.selection, undefined, topology, 1, true).subtotal.kind).toBe("Unknown");
  expect(firstStackComputeCost(undefined, f.usage, topology, 1, true).subtotal.kind).toBe("Unknown");
});

test("exact provider product location OS tenancy purchase and meter matching are required", () => {
  for (const field of ["provider", "service", "product", "region", "operatingSystem", "tenancy", "purchase"] as const) {
    const f = fixture(); f.selection.allocations[0]!.scope = { ...f.selection.allocations[0]!.scope, [field]: "unsupported" };
    expect(price(f).subtotal.kind).toBe("Unknown");
    if (field !== "region") { f.selection.allocations[0]!.tariff!.scope = f.selection.allocations[0]!.scope; expect(price(f).subtotal.kind).toBe("Unknown"); }
  }
  for (const edit of [(f: ReturnType<typeof fixture>) => { f.selection.allocations[0]!.tariff = null; },
    (f: ReturnType<typeof fixture>) => { f.selection.allocations[0]!.tariff!.provenance = "authored"; },
    (f: ReturnType<typeof fixture>) => { f.selection.allocations[0]!.tariff!.meter = "operations"; }]) {
    const f = fixture(); edit(f); expect(price(f).subtotal.kind).toBe("Unknown");
  }
});

test("expired quotes, mismatched windows, mixed currencies and unsupported billing stay Unknown", () => {
  const f = fixture(); f.selection.allocations[0]!.tariff!.validTo = f.selection.window.from; expect(price(f).subtotal.kind).toBe("Unknown");
  const boundary = fixture(60_000_001); boundary.selection.allocations[0]!.tariff!.validTo = boundary.selection.window.to;
  expect(price(boundary).subtotal.kind).toBe("Estimated");
  boundary.selection.window.to = "2026-10-16T06:02:00Z"; expect(price(boundary).subtotal.kind).toBe("Unknown");
  for (const patch of [{ currency: "EUR" }, { minimum: "0" }, { increment: "0" }, { per: "0" }]) {
    const f = fixture(); Object.assign(f.selection.allocations[0]!.tariff!, patch); expect(price(f).subtotal.kind).toBe("Unknown");
  }
  const mixed = fixture(); mixed.selection.allocations.push({ ...mixed.selection.allocations[0]!, id: "h2", host: "h2", tariff: { ...mixed.selection.allocations[0]!.tariff!, currency: "EUR" } });
  mixed.usage.allocations.push({ ...mixed.usage.allocations[0]!, id: "h2", host: "h2" });
  expect(price(mixed, { nodes: [...topology.nodes, { id: "app2", host: "h2", owner: "compute" }], placement: [{ id: "h" }, { id: "h2" }] }).subtotal.kind).toBe("Unknown");
});

test("relational/cache/LB icons, generic cores and malformed selections are not compute bindings", () => {
  for (const owner of ["relational", "keyed-cache", "load-balancer"]) expect(price(fixture(), { nodes: [{ id: "icon", host: "h", owner }], placement: [{ id: "h" }] }).subtotal.kind).toBe("Unknown");
  for (const value of [null, {}, "bad", { ...fixture().selection, extra: true }, "x".repeat(65537)]) {
    const r = firstStackComputeCost(value, fixture().usage, topology, 1, true); expect(r.subtotal.kind).toBe("Unknown"); expect(r.covered).toEqual([]);
  }
});

test("server tariffs change report cost without changing verified cut, replay or browser evidence", async () => {
  const f = await submissionFixture(), cut = f.request.browserCut, input = JSON.parse(f.input);
  const usage = cut.cut.reportCapture!.allocationUsage!, host = input.candidate.nodes.find((n: { owner: string }) => n.owner === "compute").host;
  const selection = fixture(cut.cut.throughUs).selection; selection.allocations[0]!.id = host; selection.allocations[0]!.host = host;
  const result = { verification: "verified", actual: cut.fingerprint };
  const row = { id: "cost-report", input: f.input, inputHash: cut.inputHash, engine: f.engine, lock: f.lock, status: "terminal",
    browserCut: cut, durablePrefix: cut, result, resultHash: hash(result), lineage: { infrastructureId: f.request.infrastructureId }, createdAt: new Date("2026-10-21T00:00:00Z") };
  const bytes = JSON.stringify(cut), report = firstStackReport(row, selection);
  expect(report.cost.subtotal.kind).toBe("Estimated"); expect(usage.allocations.filter(a => a.host === host)).toHaveLength(1);
  const changed = structuredClone(selection); changed.allocations[0]!.tariff!.tiers[0]!.price = "0.192";
  expect(firstStackReport(row, changed).cost.subtotal).not.toEqual(report.cost.subtotal);
  expect(JSON.stringify(cut)).toBe(bytes); expect(bytes).not.toContain("computeCost"); expect(bytes).not.toContain("OnDemand");
  const prepared = prepareFirstStackExecution(f.owner, f.layout, f.layout.firstStack, f.request.workload, f.request.policy);
  expect((await replayFirstStackPrefix(prepared, cut, cut.source, cut.inputHash)).kind).toBe("MatchesRecordedPrefix");
  expect(JSON.parse(JSON.stringify(firstStackRunRecord(row, selection))).evidence.report.cost).toEqual(report.cost);
  expect(firstStackReport(row).cost.subtotal.kind).toBe("Unknown");
  const compared = JSON.parse(JSON.stringify(compareFirstStackCosts(report.cost, firstStackReport(row).cost)));
  expect(compared.label).toBe("supported compute subtotal"); expect(compared.left.label).toBe(compared.right.label);
  expect(compared.left.fullCost.kind).toBe("Unknown"); expect(compared.right.fullCost.kind).toBe("Unknown");
  for (const verification of ["mismatch", "unverified", "interrupted", "cancelled", "unavailable"]) {
    const result = { verification, actual: cut.fingerprint };
    expect(firstStackReport({ ...row, result, resultHash: hash(result) }, selection).cost.subtotal.kind).toBe("Unknown");
  }
  expect(firstStackReport({ ...row, durablePrefix: null, result: null, resultHash: null }, selection).cost.subtotal.kind).toBe("Unknown");
  const { allocationUsage: _usage, ...legacy } = cut.cut.reportCapture!;
  const old = isolatedCut({ ...cut.cut, reportCapture: legacy }, cut.source, cut.inputHash), oldResult = { verification: "verified", actual: old.fingerprint };
  expect(firstStackReport({ ...row, durablePrefix: old, result: oldResult, resultHash: hash(oldResult) }, selection).cost.subtotal.kind).toBe("Unknown");
  // Old/client-injected cost payloads are ignored rather than trusted as tariffs.
  const oldCapture = { ...cut.cut.reportCapture!, computeCost: selection };
  const injected = isolatedCut({ ...cut.cut, reportCapture: oldCapture }, cut.source, cut.inputHash);
  const injectedResult = { verification: "verified", actual: injected.fingerprint };
  expect(firstStackReport({ ...row, durablePrefix: injected, result: injectedResult, resultHash: hash(injectedResult) }).cost.subtotal.kind).toBe("Unknown");
});

test("cost source review pins the adapter, shared capture and acceptance", () => {
  const { review: review, read: historicalSource } = historicalSlice("docs/reality/first-stack-cost-source-review.json");
  expect(review.schema).toBe("first-stack-cost-source-review/1"); expect(review.files).toHaveLength(9); expect(review.acceptance).toHaveLength(2);
  for (const row of [...review.files, ...review.acceptance ?? []]) expect(sourceHash(historicalSource(row.path))).toBe(row.hash);
});
