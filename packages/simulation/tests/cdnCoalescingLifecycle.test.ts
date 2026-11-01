import { expect, test } from "bun:test";
import { coalescingBurst, coalescingConfig } from "./cdnCoalescing.fixture";
import { createSystemsModel2 } from "../src/model2/systems/run";
import { objectCdn } from "../src/model2/systems/cdn";
import { objectStore } from "../src/model2/async/objects";
import { EventKernel } from "../src/model2/time";
import type { Invocation, RemoteOutcome } from "../src/model2/workload/contracts";
import type { SystemsInput } from "../src/model2/systems/contracts";
import { systemCommand } from "./systemsFixture";
import { quantities } from "./workloadFixture";
import { cdnSetup } from "./cdnTtl.fixture";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";

const run = (i: SystemsInput) => { const m = createSystemsModel2(i); m.advanceTo(m.horizon); return m.evidence(); };
const counters = (c: ReturnType<typeof run>["systems"]["cdns"][number]) => {
  const { coalesced, originRequests, originFailures, fills, hits, misses, expirations, purged, staleFills } = c;
  return { coalesced, originRequests, originFailures, fills, hits, misses, expirations, purged, staleFills };
};

test("proofs 2-6: same simultaneous same-key burst shares one origin fill only when On; every reply is correct", () => {
  for (const coalesce of [true, false]) {
    const e = run(coalescingBurst(coalesce)), c = e.systems.cdns[0]!;
    expect(c).toMatchObject({ misses: 10, hits: 0, originRequests: coalesce ? 1 : 10, originFailures: 0, coalesced: coalesce ? 9 : 0, fills: coalesce ? 1 : 10 });
    expect(e.systems.commands.results).toHaveLength(10);
    for (const r of e.systems.commands.results) { expect(r.outcome).toBe("completed"); expect(r.reply).toEqual({ ok: true, bytes: 128, content: "asset-v1", generation: 1 }); }
    expect(c.entries).toHaveLength(1); expect(c.storedBytes).toBe(128);
    expect(e.asynchronous.objects.find(s => s.id === "objects")!.gets).toBe(coalesce ? 1 : 10);
    console.info("cdn-coalescing-controlled-burst", JSON.stringify({ coalesce, ...counters(c) }));
  }
});

test("proofs 7-9: same burst exceeds small shared limit; refusals issue no hidden origin requests", () => {
  for (const maxWaiters of [1, 3, 10]) {
    const e = run(coalescingBurst(true, maxWaiters)), c = e.systems.cdns[0]!;
    expect(c).toMatchObject({ misses: 10, coalesced: maxWaiters - 1, originRequests: 1, fills: 1 });
    expect(e.systems.commands.results.filter(r => r.outcome === "completed")).toHaveLength(maxWaiters);
    expect(e.systems.commands.results.filter(r => (r.reply as { reason?: string }).reason === "cdn-waiter-capacity")).toHaveLength(10 - maxWaiters);
    expect(e.asynchronous.objects.find(s => s.id === "objects")!.gets).toBe(1);
  }
});

for (const coalesce of [true, false]) test(`proofs 4,16,19: TTL freshness, warm hits, expiry and deterministic stepping compose: ${coalesce}`, () => {
  const i = coalescingBurst(coalesce, undefined, 1); const q = quantities(); i.horizon = q.q("ttl.horizon", 1200000, "us"); i.ledger.push(...q.ledger);
  systemCommand(i, "warm", 20000, "$caller", "cdn", { kind: "get", key: "asset" });
  systemCommand(i, "expired", 1100000, "$caller", "cdn", { kind: "get", key: "asset" });
  const m = createSystemsModel2(i); m.advanceTo(15000);
  const before = m.evidence().systems.cdns[0]!.entries[0]!.expiresAt;
  m.advanceTo(30000); expect(m.evidence().systems.cdns[0]!.entries[0]!.expiresAt).toBe(before);
  expect(m.evidence().systems.cdns[0]!.hits).toBe(1);
  m.advanceTo(1050000); expect(m.evidence().systems.cdns[0]!).toMatchObject({ entries: [], expirations: 1 });
  m.advanceTo(m.horizon); const c = m.evidence().systems.cdns[0]!;
  expect(c.originRequests).toBe(coalesce ? 2 : 11); expect(c.entries).toHaveLength(1);
  expect(m.evidence()).toEqual(run(i));
});

function direct() {
  const i = coalescingBurst(true, 2), kernel = new EventKernel(10000);
  const config = i.resources.find(r => r.kind === "cdn")!, origin = i.resources.find(r => r.kind === "object-store")!;
  if (config.kind !== "cdn" || origin.kind !== "object-store") throw Error("Expected CDN/origin");
  const store = objectStore(origin, kernel); let originCancellations = 0;
  const cdn = objectCdn(config, kernel, (_target, work, done) => {
    const receipt = store.accept(work, done);
    return { ...receipt, cancel() { originCancellations++; return receipt.cancel(); } };
  });
  const calls = new Map<string, { work: Invocation; outcomes: RemoteOutcome[] }>();
  const get = (id: string) => {
    const work: Invocation = { rootId: id, callId: JSON.stringify([id]), attempt: 1, offeredAt: kernel.now, operation: "light", message: { request: { kind: "get", key: "asset" } } }, outcomes: RemoteOutcome[] = [];
    calls.set(id, { work, outcomes }); return cdn.accept(work, outcome => outcomes.push(outcome));
  };
  return { kernel, store, cdn, calls, get, cancellations: () => originCancellations };
}

test("proof 10: removing the initiating waiter leaves the shared origin fill owned by remaining and replacement waiters", () => {
  const h = direct(), first = h.get("a"); h.get("b"); h.kernel.advanceTo(100);
  expect(h.cdn.evidence().pendingFills).toEqual([{ key: "asset", waiters: 2 }]);
  expect(first.cancel()).toBe("cancelled"); expect(h.cancellations()).toBe(0);
  h.get("c"); h.kernel.advanceTo(200);
  expect(h.cdn.evidence().pendingFills).toEqual([{ key: "asset", waiters: 2 }]);
  h.kernel.advanceTo(5000); expect(h.cdn.evidence()).toMatchObject({ originRequests: 1, coalesced: 2, fills: 1, pendingFills: [] });
  expect(h.calls.get("a")!.outcomes).toEqual(["cancelled"]);
  for (const id of ["b", "c"]) { expect(h.calls.get(id)!.outcomes).toEqual(["completed"]); expect(h.calls.get(id)!.work.message!.response).toMatchObject({ ok: true, content: "asset-v1" }); }
});

test("proof 11: last waiter departure cancels the real origin work; a later request starts a fresh fill", () => {
  const h = direct(), a = h.get("a"), b = h.get("b"); h.kernel.advanceTo(100); a.cancel(); b.cancel();
  expect(h.cancellations()).toBe(1); expect(h.cdn.evidence().pendingFills).toEqual([]);
  h.kernel.advanceTo(3000); expect(h.store.measure().cancelled).toBe(1);
  expect(h.cdn.evidence()).toMatchObject({ fills: 0, entries: [], originFailures: 0 });
  h.get("new"); h.kernel.advanceTo(6000);
  expect(h.cdn.evidence()).toMatchObject({ originRequests: 2, fills: 1 }); expect(h.calls.get("new")!.outcomes).toEqual(["completed"]);
});

test("proofs 12-13: one real failed origin fetch fails shared waiters honestly and recovery refills", () => {
  const h = direct(); h.store.access(false, true); h.get("a"); h.get("b"); h.kernel.advanceTo(3000);
  expect(h.cdn.evidence()).toMatchObject({ originRequests: 1, originFailures: 1, coalesced: 1, fills: 0, entries: [] });
  for (const id of ["a", "b"]) { expect(h.calls.get(id)!.outcomes).toEqual(["rejected"]); expect(h.calls.get(id)!.work.message!.response).toEqual({ ok: false, reason: "origin-failed" }); }
  h.store.access(true, true); h.get("c"); h.get("d"); h.kernel.advanceTo(6000);
  expect(h.cdn.evidence()).toMatchObject({ originRequests: 2, originFailures: 1, coalesced: 2, fills: 1 });
  for (const id of ["c", "d"]) expect(h.calls.get(id)!.work.message!.response).toMatchObject({ ok: true, content: "asset-v1" });
});

for (const keyed of [true, false]) test(`proofs 14-15: purge during shared fill prevents stale repopulation; later fill and warm purge work: ${keyed}`, () => {
  const h = direct(); h.get("a"); h.get("b"); h.kernel.advanceTo(100); h.cdn.purge(keyed ? "asset" : undefined); h.kernel.advanceTo(3000);
  expect(h.cdn.evidence()).toMatchObject({ staleFills: 1, fills: 0, entries: [], purged: 0, originRequests: 1 });
  for (const id of ["a", "b"]) expect(h.calls.get(id)!.work.message!.response).toMatchObject({ ok: true, content: "asset-v1" });
  h.get("c"); h.kernel.advanceTo(6000); expect(h.cdn.evidence().entries).toHaveLength(1);
  h.cdn.purge(keyed ? "asset" : undefined);
  expect(h.cdn.evidence()).toMatchObject({ staleFills: 1, fills: 1, entries: [], purged: 1, expirations: 0 });
});

test("proofs 17-18: DNS routing and Object Storage contents unchanged by explicit default coalescing", () => {
  const historical = cdnSetup("dns"), explicit = coalescingConfig();
  const normal = cdnSetup(), v2 = createProductModel2(explicit.compiled);
  normal.runtime.advanceTo(12000000); v2.advanceTo(12000000);
  expect(v2.evidence().systems.cdns).toEqual(normal.runtime.evidence().systems.cdns);
  expect(v2.evidence().asynchronous.objects).toEqual(normal.runtime.evidence().asynchronous.objects);
  const saved = historical.saved; saved.resources[0]!.cdnCachePolicy = { version: 2, coalesce: true };
  // Reuse the same DNS topology/workload; only the saved policy changes.
  const a = contractFromDesign(saved); if ("refused" in a) throw Error(JSON.stringify(a));
  const c = compileProduct(saved, a.contract); if (!c.ok) throw Error(JSON.stringify(c));
  const dns = createProductModel2(c.value); dns.advanceTo(12000000); historical.runtime.advanceTo(12000000);
  expect(dns.evidence().systems.resolvers).toEqual(historical.runtime.evidence().systems.resolvers);
  expect(dns.evidence().systems.authorities).toEqual(historical.runtime.evidence().systems.authorities);
  expect(dns.evidence().asynchronous.objects).toEqual(historical.runtime.evidence().asynchronous.objects);
});
