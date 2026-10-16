import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cpus, release } from "node:os";
import { providerFixture, providerHasher } from "../../packages/simulation/tests/providerFixture";
import { compileProviderProduct } from "../../packages/simulation/src/reality/provider/compile";
import { createProviderModel2 } from "../../packages/simulation/src/reality/provider/run";
import { estimate } from "../../packages/simulation/src/reality/provider/pricing";
import { fromNumber } from "../../packages/simulation/src/reality/provider/exact";
import { providerRoot, providerSourceHash } from "./provider-source";
import type { Usage } from "../../packages/simulation/src/reality/provider/contracts";
export function measureProvider() {
  const f = providerFixture({ slots: 32 }), start = performance.now(), c = compileProviderProduct(f, f.provider, f.snapshot, providerHasher), compiled = performance.now(), r = createProviderModel2(c, providerHasher), setup = performance.now();

  r.advanceTo(r.horizon);

  const executed = performance.now(), e = r.evidence(), evidence = performance.now();

  const p = f.snapshot.prices[0]!, rows: Usage[] = Array.from({ length: 10000 }, (_, i) => ({
    id: `allocation-${i}`,

    resource: `host-${i}`,

    meter: "instance-us",

    fromUs: 0,

    toUs: 60000001,

    quantity: fromNumber(60000001),

    scope: p.scope,

    provenance: ["Authored maximum billing batch for executor performance only"],

    basis: "authored"
  }));

  const beforeBilling = performance.now(), bill = estimate(p, rows, { from: "2026-10-16T06:00:00Z", to: "2026-10-16T07:00:00Z", complete: true }), billed = performance.now();

  if (bill.kind !== "Estimated" || e.model.capture.failure) throw Error("Performance case failed");

  const serializedBytes = Buffer.byteLength(JSON.stringify({ provider: e.provider, bill })), serialized = performance.now();

  return {
    schema: "infraforge-provider-executor-measurement/1",

    complete: true,

    sourceHash: providerSourceHash(),

    measuredAt: new Date().toISOString(),

    environment: {
      bun: Bun.version,

      platform: process.platform,

      arch: process.arch,

      osRelease: release(),

      cpu: cpus()[0]?.model ?? "Unknown"
    },

    scope: "Single developer-host wall-clock costs, not provider physical timing or a statistical benchmark",

    hostSlots: 32,

    roles: c.product.input.resources.length,

    paths: c.product.input.paths.length,

    billingRows: rows.length,

    compileMs: compiled - start,

    setupMs: setup - compiled,

    runMs: executed - setup,

    evidenceMs: evidence - executed,

    billingMs: billed - beforeBilling,

    serializeMs: serialized - billed,

    serializedBytes,

    amount: bill.amount
  };
}
if (import.meta.main) {
  const value = measureProvider();

  writeFileSync(resolve(providerRoot, "docs/reality/m2i-performance.json"), JSON.stringify(value, null, 2) + "\n");

  console.info(JSON.stringify(value));
}
