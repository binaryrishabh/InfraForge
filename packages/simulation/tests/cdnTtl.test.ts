import { expect, test } from "bun:test";
import { cdnDesign, cdnSetup } from "./cdnTtl.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

test("learners can set CDN TTL without changing coalescing or waiter limits", () => {
  const f = cdnSetup("repeated", 1);
  expect(currentAdapterProfiles(f.saved.resources)).toEqual(["cdn-ttl/1"]);
  expect(f.compiled.input.resources.find(r => r.kind === "cdn")).toMatchObject({ ttl: { value: 1_000_000 }, coalesce: true, maxWaiters: { value: 256 } });
  expect(f.contract.ledger.find(r => r.id === "cdn.ttl")?.classification).toBe("user-input");
});

test("same seed, topology and timing: short TTL expires and performs more real origin fetches", () => {
  const short = cdnSetup("repeated", 1), long = cdnSetup("repeated", 60);
  short.runtime.advanceTo(12_000_000); long.runtime.advanceTo(12_000_000);
  const s = short.runtime.evidence().systems.cdns[0]!, l = long.runtime.evidence().systems.cdns[0]!;
  expect(s.expirations).toBeGreaterThan(0); expect(l.expirations).toBe(0);
  expect(s.originRequests).toBeGreaterThan(l.originRequests); expect(l.originRequests).toBe(1);
  expect(s.fills).toBe(s.originRequests); expect(s.originFailures).toBe(0);
  expect(l.hits).toBe(23); expect(l.misses).toBe(1);
  const counters = ({ hits, misses, originRequests, originFailures, fills, expirations, purged, staleFills }: typeof s) => ({ hits, misses, originRequests, originFailures, fills, expirations, purged, staleFills });
  console.info("cdn-ttl-controlled-comparison", JSON.stringify({ short: counters(s), long: counters(l) }));
});

test("captured profile is required exactly when numeric intent exists", () => {
  const d = cdnDesign("repeated", 60);
  for (const adapterProfiles of [[], ["queue-capacity/1"], ["cdn-ttl/1", "cdn-ttl/1"]] as const) expect(contractFromDesign(d, { adapterProfiles })).toHaveProperty("refused");
  expect(contractFromDesign(cdnDesign(), { adapterProfiles: ["cdn-ttl/1"] })).toHaveProperty("refused");
  expect(currentAdapterProfiles(cdnDesign().resources)).toEqual([]);
});

test("compiler refuses saved TTL versus materialized config and version mismatch", () => {
  const f = cdnSetup("repeated", 1);
  const config = f.contract.nodes.cdn!.resources[0]!.config; if (config.kind !== "cdn") throw Error("Expected CDN");
  config.ttl = { ...config.ttl, value: 60_000_000 };
  const row = f.contract.ledger.find(r => r.id === "cdn.ttl")!;
  row.quantity = { ...config.ttl }; row.formula = "60000000";
  const mismatched = compileProduct(f.saved, f.contract);
  expect(mismatched.ok).toBe(false);
  if (!mismatched.ok) expect(JSON.stringify(mismatched.diagnostics)).toContain("CDN TTL must match saved intent");
  const v = cdnSetup("repeated", 1); v.contract.version = v.contract.version.replace("/cdn-ttl/1", "");
  expect(compileProduct(v.saved, v.contract).ok).toBe(false);
});

test("expiry alone makes the object cold; the next request fetches it while a longer TTL stays warm", () => {
  const short = cdnSetup("repeated", 1), long = cdnSetup("repeated", 60);
  for (const f of [short, long]) f.runtime.advanceTo(1100000);
  const cold = short.runtime.evidence().systems.cdns[0]!;
  expect(cold).toMatchObject({ hits: 2, fills: 1, originRequests: 1, expirations: 1, entries: [] });
  for (const f of [short, long]) f.runtime.advanceTo(1600000);
  expect(short.runtime.evidence().systems.cdns[0]!).toMatchObject({ fills: 2, originRequests: 2, hits: 2 });
  expect(long.runtime.evidence().systems.cdns[0]!).toMatchObject({ fills: 1, originRequests: 1, hits: 3 });
  expect(short.runtime.evidence().resources.find(r => r.id === "store")!.completed).toBe(2);
  expect(long.runtime.evidence().resources.find(r => r.id === "store")!.completed).toBe(1);
});

test("adapter and compiler independently refuse malformed and wrong-owner CDN policies", () => {
  const valid = cdnSetup("repeated", 1);
  for (const value of [null, {}, { version: 1 }, { version: 2, ttlSeconds: 60 }, { version: 1, ttlSeconds: 60, coalesce: true }, ...[0, 3601, 1.5, NaN, Infinity, "60"].map(ttlSeconds => ({ version: 1, ttlSeconds }))]) {
    const d = cdnDesign(); Object.assign(d.resources[0]!, { cdnCachePolicy: value });
    expect(contractFromDesign(d)).toHaveProperty("refused"); expect(compileProduct(d, valid.contract).ok).toBe(false);
  }
  const wrong = cdnDesign(); Object.assign(wrong.resources[1]!, { cdnCachePolicy: { version: 1, ttlSeconds: 1 } });
  expect(contractFromDesign(wrong)).toHaveProperty("refused"); expect(compileProduct(wrong, valid.contract).ok).toBe(false);
});

for (const ttl of [undefined, 1, 60, 3600]) test(`one-shot and stepped evidence identical: TTL ${ttl}`, () => {
  const f = cdnSetup("dns", ttl), stepped = createProductModel2(f.compiled);
  f.runtime.advanceTo(12_000_000);
  for (let second = 1; second <= 12; second++) stepped.advanceTo(second * 1_000_000);
  expect(stepped.evidence()).toEqual(f.runtime.evidence());
});
