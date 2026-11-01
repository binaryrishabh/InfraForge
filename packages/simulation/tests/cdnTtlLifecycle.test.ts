import { expect, test } from "bun:test";
import { cdnSetup } from "./cdnTtl.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { createSystemsModel2 } from "../src/model2/systems/run";
import { systemCommand, systemsFixture } from "./systemsFixture";
import { quantities } from "./workloadFixture";
import { requireKnown } from "../src/reality/quantity";

test("saved TTL: a warm hit avoids an unavailable origin; expiry fails, recovery refills", () => {
  const f = cdnSetup("repeated", 1), q = quantities();
  f.contract.faults.push({ id: "origin-outage", kind: "Crash", target: "store", at: q.q("outage.at", 250000, "us"), duration: q.q("outage.duration", 7000000, "us"), restart: q.q("outage.restart", 1, "us"), profile: "retain-logical-state/1" });
  f.contract.ledger.push(...q.ledger);
  const c = compileProduct(f.saved, f.contract); if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value), cdn = () => runtime.evidence().systems.cdns[0]!;
  runtime.advanceTo(200000); expect(cdn()).toMatchObject({ fills: 1, originRequests: 1, hits: 0, originFailures: 0 });
  const expiresAt = cdn().entries[0]!.expiresAt;
  runtime.advanceTo(800000); expect(cdn()).toMatchObject({ hits: 1, originRequests: 1, fills: 1, originFailures: 0 });
  expect(cdn().entries[0]!.expiresAt).toBe(expiresAt);
  runtime.advanceTo(2800000); expect(cdn().expirations).toBe(1); expect(cdn().entries).toHaveLength(0);
  expect(cdn().originRequests).toBeGreaterThan(1); expect(runtime.evidence().counts.rejected).toBeGreaterThan(0);
  // The historical origin transport has a four-second response timeout; retain it.
  runtime.advanceTo(6000000); expect(cdn().originFailures).toBe(2); expect(cdn().fills).toBe(1);
  expect(runtime.evidence().resources.find(r => r.id === "store")!.paused).toBe(true);
  runtime.advanceTo(11000000); expect(cdn().fills).toBe(4); expect(cdn().entries).toHaveLength(1); expect(cdn().originFailures).toBe(5);
  expect(runtime.evidence().resources.find(r => r.id === "store")!.completed).toBe(4);
  console.info("cdn-ttl-outage-recovery", JSON.stringify({ hits: cdn().hits, misses: cdn().misses, originRequests: cdn().originRequests, originFailures: cdn().originFailures, fills: cdn().fills, expirations: cdn().expirations }));
});

test("purge immediately removes warm state before TTL; its counter differs from expiry", () => {
  const f = cdnSetup("repeated", 1), q = quantities();
  f.compiled.input.systems.interventions.push({ id: "purge", kind: "cdn-purge", target: "cdn", key: "asset", at: q.q("purge.at", 750000, "us") });
  f.compiled.input.ledger.push(...q.ledger);
  const runtime = createProductModel2(f.compiled), cdn = () => runtime.evidence().systems.cdns[0]!;
  runtime.advanceTo(700000); expect(cdn().entries).toHaveLength(1); expect(cdn().entries[0]!.expiresAt).toBeGreaterThan(750000);
  runtime.advanceTo(750000); expect(cdn()).toMatchObject({ entries: [], purged: 1, expirations: 0, fills: 1 });
  runtime.advanceTo(1200000); expect(cdn()).toMatchObject({ purged: 1, expirations: 0, fills: 2, originRequests: 2 });
});

test("purge during an origin fill still rejects the stale fill under saved TTL", () => {
  const f = cdnSetup("repeated", 1), q = quantities();
  const store = f.compiled.input.resources.find(r => r.kind === "object-store")!; if (store.kind !== "object-store") throw Error("Expected origin");
  store.demands.get!.wait = q.q("origin.slow", 300000, "us");
  f.compiled.input.systems.interventions.push({ id: "purge-fill", kind: "cdn-purge", target: "cdn", at: q.q("purge-fill.at", 100000, "us") });
  f.compiled.input.ledger.push(...q.ledger);
  const runtime = createProductModel2(f.compiled), cdn = () => runtime.evidence().systems.cdns[0]!;
  runtime.advanceTo(50000); expect(cdn().pendingFills).toHaveLength(1);
  runtime.advanceTo(400000); expect(cdn()).toMatchObject({ staleFills: 1, fills: 0, entries: [], originRequests: 1, purged: 0, expirations: 0 });
  runtime.advanceTo(900000); expect(cdn()).toMatchObject({ staleFills: 1, fills: 1, originRequests: 2 }); expect(cdn().entries).toHaveLength(1);
});

for (const ttl of [undefined, 1, 60, 3600]) test(`coalescing and the 256 waiter limit are unchanged: TTL ${ttl}`, () => {
  // Widen command admission only in this engine proof so the existing waiter bound can be reached.
  const policy = cdnSetup("repeated", ttl).compiled.input.resources.find(r => r.kind === "cdn")!;
  if (policy.kind !== "cdn") throw Error("Expected CDN");
  const i = systemsFixture({ count: 0, monitoring: false, horizon: 30000 }), q = quantities(); i.arrivals = [];
  const cdn = i.resources.find(r => r.kind === "cdn")!; if (cdn.kind !== "cdn") throw Error("Expected CDN");
  cdn.ttl = q.q("waiter.ttl", requireKnown(policy.ttl, "us"), "us"); cdn.maxWaiters = q.q("waiter.limit", requireKnown(policy.maxWaiters, "count"), "count"); cdn.coalesce = policy.coalesce;
  cdn.concurrency = q.q("waiter.command-admission", 512, "count"); cdn.demands.get!.cpu = q.q("waiter.command-cpu", 1, "cpu-us");
  const path = i.paths.find(p => p.source === "$caller" && p.target === "cdn")!; path.pool.maxConnections = q.q("waiter.connections", 512, "count");
  const origin = i.resources.find(r => r.kind === "object-store")!; if (origin.kind !== "object-store") throw Error("Expected origin");
  origin.demands.get!.wait = q.q("waiter.origin-wait", 5000, "us");
  for (let n = 0; n < 257; n++) systemCommand(i, `get-${n}`, 0, "$caller", "cdn", { kind: "get", key: "asset" });
  i.ledger.push(...q.ledger);
  const runtime = createSystemsModel2(i); runtime.advanceTo(30000);
  const e = runtime.evidence(), c = e.systems.cdns[0]!;
  expect(c).toMatchObject({ misses: 257, coalesced: 255, originRequests: 1, fills: 1 });
  expect(e.systems.commands.results.filter(r => r.outcome === "completed")).toHaveLength(256);
  expect(e.systems.commands.results.filter(r => (r.reply as { reason?: string } | undefined)?.reason === "cdn-waiter-capacity")).toHaveLength(1);
});
