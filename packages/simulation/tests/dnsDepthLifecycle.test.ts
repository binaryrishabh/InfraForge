import { expect, test } from "bun:test";
import { systemsFixture, systemCommand, systemPath } from "./systemsFixture";
import { quantities } from "./workloadFixture";
import { createSystemsModel2 } from "../src/model2/systems/run";
import type { DnsReply, ResolverConfig } from "../src/model2/systems/contracts";
import { dnsSetup } from "./dnsDepth.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { contractFromDesign } from "../src/model2/product/fromDesign";

function fixture(maxTtl = 1000, ttl = 10000) {
  const i = systemsFixture({ count: 0, ttl, monitoring: false }), q = quantities(); i.arrivals = [];
  const resolver = i.resources.find((r): r is ResolverConfig => r.kind === "dns-resolver")!;
  resolver.cachePolicy = { version: 1, maxTtl: q.q("resolver.maxTtl", maxTtl, "us") }; i.ledger.push(...q.ledger); q.ledger.length = 0;
  return { i, resolver, q };
}
const ask = (i: ReturnType<typeof fixture>["i"], id: string, at: number, name = "app.example", resolver = "resolver") => systemCommand(i, id, at, "$caller", resolver, { kind: "resolve", name });
const replies = (run: ReturnType<typeof createSystemsModel2>) => new Map(run.evidence().systems.commands.results.map(r => [r.id, r.reply as DnsReply]));

test("positive and negative answers use the ceiling without extending a shorter authority TTL", () => {
  for (const [maxTtl, ttl] of [[1000, 10000], [10000, 1000]]) {
    const { i } = fixture(maxTtl, ttl); ask(i, "cold", 0); ask(i, "warm", 500);
    const run = createSystemsModel2(i); run.advanceTo(900);
    const cached = run.evidence().systems.resolvers[0]!.cache[0]!;
    expect(cached.expiresAt).toBeLessThan(1300);
    expect(replies(run).get("cold")!.expiresAt).toBe(cached.expiresAt);
    expect(replies(run).get("warm")).toEqual(replies(run).get("cold"));
    run.advanceTo(cached.expiresAt - 1); expect(run.evidence().systems.resolvers[0]!.cache).toHaveLength(1);
    run.advanceTo(cached.expiresAt); expect(run.evidence().systems.resolvers[0]!).toMatchObject({ cache: [], expirations: 1 });
  }
});

test("negative answers hide a newly authored record until their own expiry", () => {
  const { i, q } = fixture(), authority = i.resources.find(r => r.kind === "dns-authority")!;
  if (authority.kind !== "dns-authority") throw Error("Expected authority");
  authority.negativeTtl = q.q("negative.ttl", 5000, "us");
  ask(i, "absent", 0, "new.example"); ask(i, "still-absent", 700, "new.example"); ask(i, "discovered", 2000, "new.example");
  i.systems.interventions.push({ id: "create-record", kind: "dns-record", target: "authority", at: q.q("create.at", 500, "us"), record: { ...authority.records[0]!, name: "new.example" } }); i.ledger.push(...q.ledger);
  const run = createSystemsModel2(i); run.advanceTo(run.horizon); const r = replies(run);
  expect(r.get("absent")!.reason).toBe("nxdomain"); expect(r.get("still-absent")).toEqual(r.get("absent"));
  expect(r.get("discovered")!.ok).toBe(true);
  expect(run.evidence().systems.resolvers[0]!).toMatchObject({ queries: 3, hits: 1, misses: 2, fills: 2, expirations: 2 });
});

test("cold and independently warm resolvers observe different generations without health knowledge", () => {
  const { i, resolver, q } = fixture(3000), second = { ...structuredClone(resolver), id: "cold-resolver", execution: { ...resolver.execution, id: "cold-resolver" } };
  i.resources.push(second); systemPath(i, "$caller", second.id, 53); systemPath(i, second.id, "authority", 53);
  const authority = i.resources.find(r => r.kind === "dns-authority")!;
  if (authority.kind !== "dns-authority") throw Error("Expected authority");
  ask(i, "warm", 0); ask(i, "old", 1500); ask(i, "cold", 1500, "app.example", second.id); ask(i, "expired", 4000);
  i.systems.interventions.push({ id: "update", kind: "dns-record", target: "authority", at: q.q("update.at", 1000, "us"), record: { ...authority.records[0]!, generation: 2, addresses: [i.systems.identities.find(r => r.id === "other")!.address] } }); i.ledger.push(...q.ledger);
  const run = createSystemsModel2(i); run.advanceTo(run.horizon); const r = replies(run);
  expect(["warm", "old", "cold", "expired"].map(id => r.get(id)!.generation)).toEqual([1, 1, 2, 2]);
});

test("short ceiling trades warm-cache availability for refreshing during authority outage; transient failures are not cached", () => {
  const run = (maxTtl: number) => {
    const { i, q } = fixture(maxTtl); for (const [id, at] of [["warm", 0], ["during", 2000], ["recovered", 6000]] as const) ask(i, id, at);
    const pool = i.paths.find(p => p.source === "resolver" && p.target === "authority")!.pool;
    pool.connectTimeout = q.q("upstream.connectTimeout", 500, "us"); pool.responseTimeout = q.q("upstream.responseTimeout", 500, "us");
    i.networkInterventions.push({ id: "authority-outage", kind: "service-state", target: "authority", at: q.q("down.at", 1000, "us"), duration: q.q("down.duration", 4000, "us"), alive: false, ready: false }); i.ledger.push(...q.ledger);
    const runtime = createSystemsModel2(i); runtime.advanceTo(4000);
    if (maxTtl === 1000) expect(runtime.evidence().systems.resolvers[0]!.cache).toEqual([]);
    runtime.advanceTo(runtime.horizon); return runtime;
  };
  const short = run(1000), long = run(10000);
  expect(replies(short).get("during")!.reason).toBe("authority-unavailable");
  expect(replies(long).get("during")!.ok).toBe(true);
  expect(replies(short).get("recovered")!.ok).toBe(true);
  expect(short.evidence().systems.resolvers[0]!.fills).toBe(2);
});

test("saved intent refuses missing, duplicate or mismatched profiles and tampered materialized ceiling", () => {
  const f = dnsSetup(1);
  for (const adapterProfiles of [[], ["dns-cache/1", "dns-cache/1"]] as const) expect(contractFromDesign(f.saved, { adapterProfiles })).toHaveProperty("refused");
  const noIntent = structuredClone(f.saved); delete noIntent.resources[0]!.dnsCachePolicy;
  expect(contractFromDesign(noIntent, { adapterProfiles: ["dns-cache/1"] })).toHaveProperty("refused");
  const contract = structuredClone(f.contract), resolver = contract.nodes.dns!.resources.find(r => r.config.kind === "dns-resolver")!.config;
  if (resolver.kind !== "dns-resolver" || !resolver.cachePolicy) throw Error("Expected configured resolver");
  resolver.cachePolicy.maxTtl = { ...resolver.cachePolicy.maxTtl, value: 2000000 } as typeof resolver.cachePolicy.maxTtl;
  expect(compileProduct(f.saved, contract).ok).toBe(false);
});

test("sliced and single-step replay agree across answer expiry and refresh", () => {
  const f = fixture(), i = f.i; ask(i, "cold", 0); ask(i, "expired", 3000);
  const a = createSystemsModel2(i), b = createSystemsModel2(structuredClone(i));
  a.advanceTo(a.horizon); for (let at = 0; at <= b.horizon; at += 100) b.advanceTo(at);
  expect(a.evidence()).toEqual(b.evidence());
});
