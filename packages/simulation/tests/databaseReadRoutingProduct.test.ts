import type { AdapterProfile } from "@infraforge/contracts/run-inputs";
import { expect, test } from "bun:test";
import { databaseDesign, prepareDatabase } from "./databaseReplication.fixture";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

function design(policy: "primary-only" | "replica-preferred") {
  const saved = databaseDesign(); saved.workload.readWriteRatio = 0.75;
  Object.assign(saved.resources.at(-1)!, {
    databaseReplication: { version: 1, enabled: true, replicationDelayMs: 2000, readPolicy: "primary" },
    databaseReadRouting: { version: 1, policy }, dbConcurrency: { version: 1, activeQueries: 1, queuedQueries: 32 },
  });
  return saved;
}

test("read routing refuses absent, duplicate, mismatched and unowned captured profiles and materialized policies", () => {
  const saved = design("replica-preferred"), f = prepareDatabase(saved);
  expect(contractFromDesign(saved, { failureCause: false })).toHaveProperty("refused");
  for (const adapterProfiles of [[], ["db-read-routing/1", "db-read-routing/1"]] as const) expect(contractFromDesign(saved, { adapterProfiles: [...adapterProfiles] as AdapterProfile[] })).toHaveProperty("refused");
  expect(contractFromDesign(databaseDesign(), { adapterProfiles: ["db-read-routing/1"] })).toHaveProperty("refused");
  for (const version of ["", "/db-read-routing/2", "/db-read-routing/1/db-read-routing/1"]) {
    const contract = structuredClone(f.contract); contract.version = contract.version.replace("/db-read-routing/1", version);
    expect(compileProduct(saved, contract).ok).toBe(false);
  }
  for (const policy of [undefined, { version: 1, policy: "primary-only" }] as const) {
    const contract = structuredClone(f.contract), db = contract.nodes.db!.resources.find(r => r.config.kind === "relational")!.config;
    if (db.kind !== "relational") throw Error("Database"); db.readRouting = policy;
    expect(compileProduct(saved, contract).ok).toBe(false);
  }
  const contract = structuredClone(f.contract); contract.nodes.db!.profileVersion = contract.nodes.db!.profileVersion.replace("/db-read-routing/1", "");
  expect(compileProduct(saved, contract).ok).toBe(false);
});

function burst(policy: "primary-only" | "replica-preferred") {
  const saved = design(policy), f = prepareDatabase(saved);
  f.compiled.input.arrivals = [{ id: "read-routing", kind: "trace", trace: {
    schema: "infraforge-arrivals/1", unit: "us", durationUs: 1_000_000, provenance: "Same VM to database read/write bursts; only saved routing policy differs",
    rows: Array.from({ length: 128 }, (_, i) => ({ id: String(i), atUs: Math.floor(i / 8) * 25000, operation: i % 4 === 0 ? "write" : "read" })),
  } }];
  return { ...f, runtime: createProductModel2(f.compiled) };
}

test("VM to database causal comparison changes primary CPU load and caller latency with only policy changed", () => {
  const proof = [];
  for (const policy of ["primary-only", "replica-preferred"] as const) {
    const a = burst(policy), b = burst(policy);
    a.runtime.advanceTo(1_000_000);
    for (let at = 10000; at <= 1_000_000; at += 10000) b.runtime.advanceTo(at);
    const e = a.runtime.evidence(); expect(e).toEqual(b.runtime.evidence());
    expect(e.counts.completed).toBe(128); expect(e.counts.rejected).toBe(0);
    const db = e.data.databases[0]!, routing = db.databaseReadRouting!;
    const times = e.results.filter(r => r.outcome === "completed").map(r => r.responseUs).sort((a, b) => a - b);
    expect(e.resultRetention.omitted).toBe(0);
    proof.push({ policy, primaryCpuUs: routing.members.primary.consumedCoreUs, replicaCpuUs: routing.members.replica.consumedCoreUs,
      staleReads: routing.staleReads, maxStaleReadAgeMs: routing.maxStaleReadAgeMs, primaryPeakQueued: routing.members.primary.peakQueued, p95Us: times[Math.ceil(times.length * 0.95) - 1]! });
  }
  expect(proof[1]!.primaryCpuUs).toBeLessThan(proof[0]!.primaryCpuUs);
  expect(proof[1]!.replicaCpuUs).toBeGreaterThan(0); expect(proof[0]!.replicaCpuUs).toBe(0);
  expect(proof[1]!.p95Us).toBeLessThan(proof[0]!.p95Us);
  expect(proof[0]!.staleReads).toBe(0); expect(proof[1]!.staleReads).toBeGreaterThan(0);
  console.info("dbroute-vm-causal", JSON.stringify(proof));
});
