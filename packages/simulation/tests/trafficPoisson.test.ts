import { expect, test } from "bun:test";
import { openRows, rateRows } from "../src/model2/workload/arrivals";
import type { RateArrivals } from "../src/model2/workload/contracts";
import { keyspaceDesign } from "./keyspace.fixture";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { quantities } from "./workloadFixture";

const rate = (extra: Partial<RateArrivals> = {}): RateArrivals => ({ schema: "infraforge-rate-arrivals/2", provenance: "test", startUs: 0, endUs: 100000000,
  intervalUs: 1000, readFraction: 0.8, readOperation: "read", writeOperation: "write", changes: [], ...extra });
const rows = (r = rate(), seed = "traffic") => [...openRows({ id: "product-workload", kind: "rate", rate: r }, seed)];

test("Poisson is seeded, bounded, statistically consistent in count and independent operation choice", () => {
  const a = rows(); expect(rows()).toEqual(a); expect(JSON.stringify(rows(rate(), "other")) === JSON.stringify(a)).toBe(false);
  expect(a.length).toBeGreaterThan(98000); expect(a.length).toBeLessThan(102000);
  expect(a.filter(r => r.operation === "read").length / a.length).toBeCloseTo(0.8, 2);
  expect(a.every((r, i) => Number.isSafeInteger(r.atUs) && r.atUs >= 0 && r.atUs < 100000000 && (!i || r.atUs >= a[i - 1]!.atUs))).toBe(true);
});

test("hazard is carried across peak and zero/load boundaries rather than redrawn or using a stale rate", () => {
  const baseline = rows(rate({ endUs: 100000, intervalUs: 1000000 }));
  const r = rate({ endUs: 10000000, intervalUs: 1000000 });
  const first = rows(r)[0]!.atUs;
  const boundary = Math.floor(first / 2);
  const changed = rows({ ...r, changes: [{ atUs: boundary, fraction: 2 }] });
  expect(Math.abs(changed[0]!.atUs - (boundary + (first - boundary) / 2))).toBeLessThanOrEqual(1);
  const stopped = rows({ ...r, changes: [{ atUs: boundary, fraction: 0 }, { atUs: boundary + 1000000, fraction: 1 }] });
  expect(stopped[0]!.atUs).toBe(first + 1000000);
  expect(rows({ ...r, changes: [{ atUs: 0, fraction: 0 }] })).toEqual([]);
  expect(baseline.length).toBeLessThan(3);
  const peak = { startUs: boundary, endUs: 10000000, multiplier: 2 };
  expect(rows({ ...r, peak })[0]!.atUs).toBe(changed[0]!.atUs);
});

test("single and repeating peaks increase measured arrivals; zero rate ignores peak boundaries efficiently", () => {
  const r = rate(), base = rows(r);
  const peak = rows({ ...r, peak: { startUs: 10000000, endUs: 20000000, multiplier: 4 } });
  const repeating = rows({ ...r, peak: { startUs: 10000000, endUs: 20000000, everyUs: 20000000, multiplier: 4 } });
  expect(peak.length).toBeGreaterThan(base.length * 1.25);
  expect(repeating.length).toBeGreaterThan(base.length * 2);
  expect(rows({ ...r, peak: { startUs: 1, endUs: 2, everyUs: 3, multiplier: 2 }, changes: [{ atUs: 0, fraction: 0 }] })).toEqual([]);
});

test("normal product stored traces and stepped live generation agree with peaks and live load changes", () => {
  const d = keyspaceDesign(); d.workload.workloadDynamics = { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0 };
  d.workload.trafficShape = "peak"; d.workload.peakMultiplier = 2;
  const a = contractFromDesign(d); if ("refused" in a) throw Error(JSON.stringify(a));
  a.contract.seed = "product-poisson";
  const { q, ledger } = quantities();
  a.contract.arrival.peak = { start: q("peak.s", 500000, "us"), end: q("peak.e", 1000000, "us"), every: q("peak.r", 2000000, "us") };
  a.contract.arrival.changes = [{ at: q("change.t", 2000000, "us"), fraction: q("change.f", 0.5, "ratio") },
    { at: q("zero.t", 3000000, "us"), fraction: q("zero.f", 0, "ratio") }, { at: q("resume.t", 4000000, "us"), fraction: q("resume.f", 1, "ratio") }];
  a.contract.ledger.push(...ledger);
  const stored = compileProduct(d, a.contract), live = compileProduct(d, { ...a.contract, arrival: { ...a.contract.arrival, generated: true } });
  if (!stored.ok || !live.ok) throw Error(JSON.stringify({ stored, live }));
  const source = live.value.input.arrivals[0]!; expect(source.kind).toBe("rate");
  expect([...openRows(source, a.contract.seed)]).toEqual([...openRows(stored.value.input.arrivals[0]!, a.contract.seed)]);
  const one = createProductModel2(stored.value), stepped = createProductModel2(live.value);
  one.advanceTo(5000000); for (let t = 100000; t <= 5000000; t += 100000) stepped.advanceTo(t);
  const x = stepped.evidence(), y = one.evidence(); expect(x.counts).toEqual(y.counts); expect(x.results).toEqual(y.results); expect(x.resources).toEqual(y.resources);
});

test("explicit even/fixed produces the historical compiled form", () => {
  const d = keyspaceDesign(), old = contractFromDesign(d); if ("refused" in old) throw Error(JSON.stringify(old));
  const c = compileProduct(d, old.contract);
  d.workload.workloadDynamics = { version: 1, arrivalProcess: "even", applicationCpuCv: 0 };
  const a = contractFromDesign(d); if ("refused" in a) throw Error(JSON.stringify(a));
  expect(a).toEqual(old); expect(compileProduct(d, a.contract)).toEqual(c);
  expect([...rateRows({ ...rate({ endUs: 10000 }), schema: "infraforge-rate-arrivals/1" })]).toHaveLength(10);
});
