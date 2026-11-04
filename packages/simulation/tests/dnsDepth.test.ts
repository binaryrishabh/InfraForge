import { expect, test } from "bun:test";
import { dnsSetup } from "./dnsDepth.fixture";
import { systemsFixture } from "./systemsFixture";
import { quantities } from "./workloadFixture";
import { createSystemsModel2 } from "../src/model2/systems/run";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { requireKnown } from "../src/reality/quantity";

function movedDestination(maxTtlSeconds: number, create = createSystemsModel2) {
  const saved = dnsSetup(maxTtlSeconds).compiled.input.resources.find(r => r.kind === "dns-resolver");
  if (saved?.kind !== "dns-resolver" || !saved.cachePolicy) throw Error("Expected saved resolver ceiling");
  const i = systemsFixture({ count: 8, interval: 1000000, ttl: 20000000, horizon: 10000000, monitoring: false }), q = quantities();
  i.sampleInterval = q.q("proof.sampleInterval", 100000, "us");
  const resolver = i.resources.find(r => r.kind === "dns-resolver")!;
  Object.assign(resolver, { cachePolicy: { version: 1, maxTtl: q.q("resolver.maxTtl", requireKnown(saved.cachePolicy.maxTtl, "us"), "us") } });
  const address = (id: string) => i.systems.identities.find(x => x.id === id)!.address;
  i.paths.find(p => p.id === "$caller:app")!.pool.reuse = false;
  i.systems.connections.find(c => c.path === "$caller:app")!.dns = { name: "app.example", resolver: "resolver", routes: [{ address: address("app"), path: "$caller:app" }, { address: address("other"), path: "$caller:other" }] };
  const authority = i.resources.find(r => r.kind === "dns-authority")!;
  if (authority.kind !== "dns-authority") throw Error("Expected authority");
  // An operator publishes the new record, independently of destination health.
  i.systems.interventions.push({ id: "move", kind: "dns-record", target: "authority", at: q.q("move.at", 750000, "us"), record: { ...authority.records[0]!, addresses: [address("other")], generation: 2 } });
  i.networkInterventions.push({ id: "destination-down", kind: "service-state", target: "app", at: q.q("failure.at", 500000, "us"), duration: q.q("failure.duration", 9000000, "us"), alive: false, ready: false });
  i.ledger.push(...q.ledger);
  return create(i);
}

test("resolver TTL ceiling changes failed-destination attempts and recovery after an authored record move", () => {
  const short = movedDestination(1), long = movedDestination(5);
  for (const run of [short, long]) run.advanceTo(900000);
  for (const run of [short, long]) {
    const e = run.evidence();
    expect(e.systems.authorities[0]!.records[0]!.generation).toBe(2);
    expect(e.systems.resolvers[0]!.cache[0]!.answer.generation).toBe(1);
  }
  for (const run of [short, long]) run.advanceTo(3000000);
  expect(short.evidence().resources.find(r => r.id === "other")!.completed).toBeGreaterThan(0);
  expect(long.evidence().resources.find(r => r.id === "other")!.received).toBe(0);
  for (const run of [short, long]) run.advanceTo(run.horizon);
  const a = short.evidence(), b = long.evidence();
  const recoveredAt = (e: typeof a) => e.systems.security.events.rows.find(r => r.kind === "connection-admitted" && r.detail.startsWith("other:"))!.at;
  expect(a.systems.security.failed).toBeLessThan(b.systems.security.failed);
  expect(recoveredAt(a)).toBeLessThan(recoveredAt(b));
  expect(a.counts.completed).toBeGreaterThan(b.counts.completed);
  for (const e of [a, b]) {
    expect(e.systems.security.events.rows.filter(r => r.kind === "connection-denied").every(r => r.detail === "endpoint-not-ready")).toBe(true);
    const r = e.systems.resolvers[0]!;
    expect(r.queries).toBe(r.hits + r.misses);
    expect(r.fills).toBe(r.cache.length + r.expirations + r.evictions + r.replaced);
    expect(e.counts.offered).toBe(8);
    expect(e.counts.completed + e.counts.rejected + e.counts.deadlineExceeded + e.counts.abandoned).toBe(8);
    expect(e.network.links.find(l => l.id === "$caller:other:request")!.transmittedBytes).toBeGreaterThan(0);
  }
  console.info("dns-depth-routing", JSON.stringify({ short: { failedConnections: a.systems.security.failed, completed: a.counts.completed, recoveredAtUs: recoveredAt(a), recoveryAfterFailureUs: recoveredAt(a) - 500000 }, long: { failedConnections: b.systems.security.failed, completed: b.counts.completed, recoveredAtUs: recoveredAt(b), recoveryAfterFailureUs: recoveredAt(b) - 500000 } }));
});

test("saved resolver ceiling materializes without changing the authoritative record TTL", () => {
  const f = dnsSetup(1), resolver = f.compiled.input.resources.find(r => r.kind === "dns-resolver")!;
  expect(resolver).toHaveProperty("cachePolicy.version", 1);
  expect(resolver).toHaveProperty("cachePolicy.maxTtl.value", 1000000);
  f.runtime.advanceTo(500000);
  const e = f.runtime.evidence();
  expect(e.systems.authorities[0]!.records[0]!.ttl).toHaveProperty("value", 60000000);
  expect(e.systems.resolvers[0]!.cache[0]!.expiresAt).toBeLessThan(1500000);
});

test("browser and server route the same stale DNS answers across record change, failure and expiry", async () => {
  const entry = resolve(import.meta.dir, `../../../.cache/dns-routing-${process.pid}.ts`), bundle = entry.replace(/\.ts$/, ".mjs");
  await mkdir(dirname(entry), { recursive: true });
  try {
    await writeFile(entry, 'export { createSystemsModel2 } from "../packages/simulation/src/model2/systems/run";\n', "utf8");
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", entry, "--target=browser", "--outfile", bundle], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(); if (await build.exited !== 0) throw Error(diagnostics);
    const browser: typeof createSystemsModel2 = (await import(pathToFileURL(bundle).href)).createSystemsModel2;
    for (const ttl of [1, 5]) {
      const a = movedDestination(ttl), b = movedDestination(ttl, browser);
      for (const at of [500000, 750000, 900000, 1000000, 2000000, 3000000, 5000000, 6000000, a.horizon]) {
        a.advanceTo(at); b.advanceTo(at); expect(b.evidence()).toEqual(a.evidence());
      }
    }
  } finally { for (const p of [entry, bundle]) if (await Bun.file(p).exists()) await unlink(p); }
});
