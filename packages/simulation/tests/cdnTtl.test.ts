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
  expect(compileProduct(f.saved, f.contract).ok).toBe(false);
  const v = cdnSetup("repeated", 1); v.contract.version = v.contract.version.replace("/cdn-ttl/1", "");
  expect(compileProduct(v.saved, v.contract).ok).toBe(false);
});

for (const ttl of [undefined, 1, 60, 3600]) test(`one-shot and stepped evidence identical: TTL ${ttl}`, () => {
  const f = cdnSetup("dns", ttl), stepped = createProductModel2(f.compiled);
  f.runtime.advanceTo(12_000_000);
  for (let second = 1; second <= 12; second++) stepped.advanceTo(second * 1_000_000);
  expect(stepped.evidence()).toEqual(f.runtime.evidence());
});
