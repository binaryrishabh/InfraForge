import { expect, test } from "bun:test";
import { coalescingConfig, coalescingDesign } from "./cdnCoalescing.fixture";
import { cdnDesign } from "./cdnTtl.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";

for (const coalesce of [true, false]) test(`saved coalescing ${coalesce} reaches the engine with its own captured profile`, () => {
  const f = coalescingConfig(coalesce);
  expect(currentAdapterProfiles(f.saved.resources)).toEqual(["cdn-coalescing/1"]);
  expect(f.config).toMatchObject({ coalesce, ttl: { value: 60000000 }, maxWaiters: { value: 256 } });
  expect(f.contract.version).toContain("/cdn-coalescing/1");
  expect(f.contract.version).not.toContain("/cdn-ttl/1");
  expect(f.contract.nodes.cdn!.profileVersion).toContain("/cdn-coalescing/1");
});
test("version 2 composes explicit TTL and records authored quantities", () => {
  const f = coalescingConfig(true, 3, 1);
  expect(currentAdapterProfiles(f.saved.resources)).toEqual(["cdn-ttl/1", "cdn-coalescing/1"]);
  expect(f.config).toMatchObject({ ttl: { value: 1000000 }, maxWaiters: { value: 3 } });
  expect(f.contract.ledger.find(e => e.id === "cdn.waiters")?.classification).toBe("user-input");
});
test("missing, mismatched and duplicate captured coalescing profiles refuse", () => {
  for (const adapterProfiles of [[], ["cdn-ttl/1"], ["cdn-coalescing/1", "cdn-coalescing/1"]] as const) expect(contractFromDesign(coalescingDesign(), { adapterProfiles })).toHaveProperty("refused");
  for (const design of [cdnDesign(), cdnDesign("repeated", 60)]) expect(contractFromDesign(design, { adapterProfiles: ["cdn-coalescing/1"] })).toHaveProperty("refused");
});
test("compiler independently refuses policy, profile and materialized intent mismatches", () => {
  for (const field of ["coalesce", "maxWaiters", "ttl"] as const) {
    const f = coalescingConfig(true, 3, 1), config = f.contract.nodes.cdn!.resources[0]!.config;
    if (config.kind !== "cdn") throw Error("Expected CDN");
    if (field === "coalesce") config.coalesce = false;
    else {
      if (field === "ttl") {
        if (config.ttl.kind !== "known") throw Error("Expected known TTL");
        config.ttl = { ...config.ttl, value: 60000000 };
      } else {
        if (config.maxWaiters.kind !== "known") throw Error("Expected known waiter limit");
        config.maxWaiters = { ...config.maxWaiters, value: 256 };
      }
      const value = config[field]; if (value.kind !== "known") throw Error("Expected known quantity");
      const row = f.contract.ledger.find(e => e.id === value.provenance[0])!;
      row.quantity = value; row.formula = String(value.value);
    }
    const result = compileProduct(f.saved, f.contract);
    expect(result.ok).toBe(false); if (!result.ok) expect(JSON.stringify(result.diagnostics)).toContain("must match saved intent");
  }
  for (const version of ["canvas-assumptions/2", "canvas-assumptions/2/cdn-coalescing/1/cdn-coalescing/1"]) {
    const f = coalescingConfig(); f.contract.version = version; expect(compileProduct(f.saved, f.contract).ok).toBe(false);
  }
  const f = coalescingConfig();
  for (const policy of [{ version: 2, coalesce: false, maxWaiters: 2 }, { version: 2, coalesce: true, maxWaiters: 100001 }, { version: 2 }, { version: 1, ttlSeconds: 60, coalesce: true }]) {
    const d = coalescingDesign(); Object.assign(d.resources[0]!, { cdnCachePolicy: policy });
    expect(contractFromDesign(d)).toHaveProperty("refused"); expect(compileProduct(d, f.contract).ok).toBe(false);
  }
});

test("compiler refuses missing, duplicate or unsupported owned coalescing profiles", () => {
  for (const version of ["canvas-assumptions/2", "canvas-assumptions/2/cdn-coalescing/1/cdn-coalescing/1", "canvas-assumptions/2/cdn-coalescing/2", "canvas-assumptions/2/cdn-coalescing/10"]) {
    const f = coalescingConfig(); f.contract.nodes.cdn!.profileVersion = version;
    expect(compileProduct(f.saved, f.contract).ok).toBe(false);
  }
  const f = coalescingConfig(); f.contract.version = "canvas-assumptions/2/cdn-coalescing/10";
  expect(compileProduct(f.saved, f.contract).ok).toBe(false);
});
