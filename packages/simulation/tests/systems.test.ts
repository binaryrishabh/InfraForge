import { expect, test } from "bun:test";
import { createSystemsModel2 } from "../src/model2/systems/run";
import type { AuthorityConfig, CdnConfig, FirewallRule, MonitorConfig, StartupConfig, SystemsInput } from "../src/model2/systems/contracts";
import { quantities } from "./workloadFixture";
import { systemCommand, systemsFixture } from "./systemsFixture";
import { systemPath } from "./systemsFixture";
import { dataFixture } from "./dataFixture";
import type { ComputeResource } from "../src/model2/compute/contracts";
import { keyedUniform } from "../src/model2/random";
export function systemsRun(i: SystemsInput, steps?: number) { const m = createSystemsModel2(i); if (steps) for (let at = steps; at < m.horizon; at += steps) m.advanceTo(at); m.advanceTo(m.horizon); return m.evidence(); }
export function systemsConservation(e: ReturnType<typeof systemsRun>) {
  for (const r of e.resources) expect(r.received === r.admitted + r.rejected && r.admitted === r.completed + r.failed + r.cancelled + r.queued + r.serving + r.waiting).toBe(true);
  for (const dns of e.systems.resolvers) { expect(dns.queries).toBe(dns.hits + dns.misses); expect(dns.fills).toBe(dns.cache.length + dns.expirations + dns.evictions + dns.replaced); }
  for (const c of e.systems.cdns) { expect(c.storedBytes).toBe(c.entries.reduce((n, o) => n + o.bytes, 0)); expect(c.fills).toBe(c.entries.length + c.replaced + c.evictions + c.expirations + c.purged); }
  const security = e.systems.security; expect(security.attempts).toBe(security.established + security.failed + security.cancelled + security.pending); expect(security.established).toBe(security.sessions.length + security.closed); expect(security.tlsAttempts).toBe(security.tlsEstablished + security.tlsFailed);
  for (const fw of security.policies) { expect(fw.opened).toBe(fw.flows.length + fw.closed); expect(fw.evaluated).toBe(fw.allowed + fw.denied); }
  for (const registry of e.systems.registries) { expect(registry.blobBytes).toBe(registry.blobs.reduce((n, b) => n + b.bytes, 0)); for (const m of registry.manifests) for (const b of m.layers) expect(registry.blobs).toContainEqual(b); for (const digest of Object.values(registry.tags)) expect(registry.manifests.some((m) => m.digest === digest)).toBe(true); }
  for (const node of e.systems.clients) expect(node.cachedBytes).toBe(node.cache.reduce((n, b) => n + b.bytes, 0));
  for (const monitor of e.systems.monitors) { const flying = monitor.inFlight.flatMap((b) => b.rows); expect(monitor.generated).toBe(monitor.buffered.length + flying.length + monitor.exported + monitor.dropped); expect(monitor.bufferedBytes).toBe(monitor.buffered.reduce((n, row) => n + row.sample.bytes, 0)); expect(monitor.inFlightBytes).toBe(flying.reduce((n, row) => n + row.sample.bytes, 0)); }
}
test("M2G composes earlier async resources and collection without invented state", () => {
  const e = systemsRun(systemsFixture()); expect(e.counts.completed).toBe(4); expect(e.asynchronous.brokers[0]!.acknowledged).toBe(4); expect(e.systems.monitors[0]!.generated).toBeGreaterThan(0); expect(e.systems.backends[0]!.samples.length).toBeGreaterThan(0); systemsConservation(e);
});
test("DNS caches actual answers, expires during outage and preserves already established sessions", () => {
  const make = (reuse: boolean) => { const i = systemsFixture({ count: 6, interval: 2000, ttl: 2500, monitoring: false }), q = quantities();
    const dial = i.systems.connections.find((c) => c.path === "$caller:app")!; dial.dns = { name: "app.example", resolver: "resolver", routes: [{ address: i.systems.identities.find((x) => x.id === "app")!.address, path: "$caller:app" }] };
    i.paths.find((p) => p.id === "$caller:app")!.pool.reuse = reuse;
    i.networkInterventions.push({ id: "authority-down", kind: "service-state", target: "authority", at: q.q("auth.down", 1000, "us"), duration: q.q("auth.duration", 12000, "us"), alive: false, ready: false }); i.ledger.push(...q.ledger); return i; };
  const reused = systemsRun(make(true)), fresh = systemsRun(make(false)); expect(reused.counts.completed).toBe(6); expect(fresh.counts.completed).toBe(2); expect(fresh.systems.security.dnsFailed + fresh.systems.security.cancelled).toBe(4); expect(fresh.systems.resolvers[0]!.hits).toBe(1); systemsConservation(reused); systemsConservation(fresh);
});
test("DNS changes preserve cached generation until expiry", () => {
  const i = systemsFixture({ count: 0, ttl: 3000, monitoring: false }), q = quantities(); i.arrivals = [];
  const authority = i.resources.find((r): r is AuthorityConfig => r.kind === "dns-authority")!, address = i.systems.identities.find((x) => x.id === "other")!.address;
  systemCommand(i, "first", 0, "$caller", "resolver", { kind: "resolve", name: "app.example" }); systemCommand(i, "cached", 2000, "$caller", "resolver", { kind: "resolve", name: "app.example" }); systemCommand(i, "new", 4000, "$caller", "resolver", { kind: "resolve", name: "app.example" });
  i.systems.interventions.push({ id: "record-change", kind: "dns-record", target: "authority", at: q.q("record.at", 1000, "us"), record: { ...authority.records[0]!, addresses: [address], generation: 2 } }); i.ledger.push(...q.ledger);
  const e = systemsRun(i), results = new Map(e.systems.commands.results.map((r) => [r.id, r.reply as { generation: number }])); expect(results.get("cached")!.generation).toBe(1); expect(results.get("new")!.generation).toBe(2); systemsConservation(e);
});
test("DNS-selected address changes the actual destination and byte path", () => {
  const i = systemsFixture({ count: 2, interval: 5000, ttl: 1000, monitoring: false }), q = quantities(), address = i.systems.identities.find((x) => x.id === "other")!.address;
  i.paths.find((p) => p.id === "$caller:app")!.pool.reuse = false; i.systems.connections.find((c) => c.path === "$caller:app")!.dns = { name: "app.example", resolver: "resolver", routes: [{ address: i.systems.identities.find((x) => x.id === "app")!.address, path: "$caller:app" }, { address, path: "$caller:other" }] };
  const authority = i.resources.find((r): r is AuthorityConfig => r.kind === "dns-authority")!; i.systems.interventions.push({ id: "move", kind: "dns-record", target: "authority", at: q.q("move.at", 2000, "us"), record: { ...authority.records[0]!, addresses: [address], generation: 2 } }); i.ledger.push(...q.ledger);
  const e = systemsRun(i); expect(e.counts.completed).toBe(2); expect(e.resources.find((r) => r.id === "other")!.completed).toBe(1); expect(e.resources.find((r) => r.id === "app")!.completed).toBe(1); expect(e.network.links.find((l) => l.id === "$caller:other:request")!.transmittedBytes).toBeGreaterThan(0); systemsConservation(e);
});
test("CDN warm objects survive origin outage; expired misses fail and recovery refills", () => {
  const i = systemsFixture({ count: 0, ttl: 5000, monitoring: false, horizon: 40000 }), q = quantities(); i.arrivals = [];
  for (const [id, at] of [["cold", 0], ["warm-down", 2000], ["expired-down", 7000], ["old-fill-pending", 15000], ["recovered", 26000]] as const) systemCommand(i, id, at, "$caller", "cdn", { kind: "get", key: "asset" });
  i.networkInterventions.push({ id: "origin-down", kind: "service-state", target: "objects", at: q.q("origin.at", 1000, "us"), duration: q.q("origin.duration", 10000, "us"), alive: false, ready: false }); i.ledger.push(...q.ledger);
  const e = systemsRun(i), outcomes = Object.fromEntries(e.systems.commands.results.map((r) => [r.id, r.outcome])); expect(outcomes).toEqual({ cold: "completed", "warm-down": "completed", "expired-down": "rejected", "old-fill-pending": "rejected", recovered: "completed" }); expect(e.systems.cdns[0]!.hits).toBe(1); expect(e.systems.cdns[0]!.originRequests).toBe(3); systemsConservation(e);
});
test("coalescing shares an actual origin fill while disabled mode performs every fetch; purge rejects stale refill", () => {
  const make = (coalesce: boolean) => { const i = systemsFixture({ count: 0, coalesce, monitoring: false }); i.arrivals = []; for (let n = 0; n < 10; n++) systemCommand(i, `get-${n}`, 0, "$caller", "cdn", { kind: "get", key: "asset" }); return i; };
  const one = systemsRun(make(true)), many = systemsRun(make(false)); expect(one.systems.cdns[0]!.originRequests).toBe(1); expect(many.systems.cdns[0]!.originRequests).toBe(10); systemsConservation(one); systemsConservation(many);
  const i = make(true), q = quantities(); (i.resources.find((r) => r.kind === "object-store") as import("../src/model2/async/contracts").ObjectConfig).demands.get!.wait = q.q("origin.get.wait", 1000, "us"); i.systems.interventions.push({ id: "purge", kind: "cdn-purge", target: "cdn", key: "asset", at: q.q("purge.at", 500, "us") }); i.ledger.push(...q.ledger); const e = systemsRun(i); expect(e.systems.cdns[0]!.staleFills).toBe(1); expect(e.systems.cdns[0]!.fills).toBe(0); systemsConservation(e);
});
export function denyRule(i: SystemsInput, id: string, target: string, port: number): FirewallRule { const q = quantities(); const rule: FirewallRule = { id, direction: "ingress", protocol: "tcp", source: { kind: "any" }, destination: { kind: "identity", value: target }, fromPort: q.q(`${id}.from`, port, "count"), toPort: q.q(`${id}.to`, port, "count"), priority: q.q(`${id}.priority`, 0, "count"), action: "deny" }; i.ledger.push(...q.ledger); return rule; }
test("firewall denies before DB work; no listener differs from permission; public exposure is derived", () => {
  const allowed = systemsFixture({ monitoring: false }); systemCommand(allowed, "db", 0, "$caller", "db", { kind: "execute", key: "k0" });
  const denied = structuredClone(allowed); denied.systems.firewalls[0]!.rules = [denyRule(denied, "block-db", "db", 5432)];
  const a = systemsRun(allowed), b = systemsRun(denied); expect(a.systems.assessment.findings.some((f) => f.kind === "internet-reachable-db")).toBe(true); expect(b.systems.security.policies[0]!.denied).toBeGreaterThan(0); expect(b.data.databases[0]!.transactions.committed).toBe(0);
  const noListener = structuredClone(allowed); noListener.systems.listeners = noListener.systems.listeners.filter((l) => l.resource !== "db"); const c = systemsRun(noListener); expect(c.systems.assessment.findings.some((f) => f.kind === "allowed-port-without-listener")).toBe(true); systemsConservation(a); systemsConservation(b); systemsConservation(c);
});
test("TLS incompatible clients fail before application delivery; name/trust/expiry checks gate new sessions", () => {
  const make = (secure: boolean, name = "app.example") => { const i = systemsFixture({ monitoring: false }), q = quantities(), listener = i.systems.listeners.find((l) => l.resource === "app")!;
    listener.tls = "required"; listener.certificate = { names: ["app.example"], issuer: "lab-ca", notBefore: q.q("cert.start", 0, "us"), notAfter: q.q("cert.end", 100000, "us") };
    if (secure) i.systems.connections.find((c) => c.path === "$caller:app")!.tls = { mode: "authenticated", serverName: name, trustedIssuers: ["lab-ca"] }; i.ledger.push(...q.ledger); return i; };
  const plain = systemsRun(make(false)), tls = systemsRun(make(true)), mismatch = systemsRun(make(true, "wrong.example")); expect(plain.counts.completed).toBe(0); expect(tls.counts.completed).toBe(4); expect(mismatch.counts.completed).toBe(0); expect(plain.resources.find((r) => r.id === "app")!.received).toBe(0); systemsConservation(plain); systemsConservation(tls); systemsConservation(mismatch);
});
test("stateful policy updates retain existing connections and deny new flows", () => {
  const make = (reuse: boolean) => { const i = systemsFixture({ count: 4, interval: 2000, monitoring: false }), q = quantities(); i.paths.find((p) => p.id === "$caller:app")!.pool.reuse = reuse;
    i.systems.interventions.push({ id: "block-new", kind: "firewall-rules", target: "fw", at: q.q("policy.at", 1000, "us"), rules: [denyRule(i, "new-ingress", "app", 80)] }); i.ledger.push(...q.ledger); return i; };
  const reused = systemsRun(make(true)), fresh = systemsRun(make(false)); expect(reused.counts.completed).toBe(4); expect(fresh.counts.completed).toBe(1); expect(reused.systems.security.policies[0]!.returnExchanges).toBeGreaterThan(0); systemsConservation(reused); systemsConservation(fresh);
});
export const layerA = `sha256:${"a".repeat(64)}`, layerB = `sha256:${"b".repeat(64)}`, layerC = `sha256:${"c".repeat(64)}`, imageA = `sha256:${"d".repeat(64)}`, imageB = `sha256:${"e".repeat(64)}`;
export function registrySeed(i: SystemsInput) {
  for (const [digest, bytes] of [[layerA, 128], [layerB, 64], [layerC, 256]] as const) systemCommand(i, `upload-${digest}`, 0, "$caller", "registry", { kind: "upload", digest, bytes }, bytes);
  systemCommand(i, "manifest-a", 500, "$caller", "registry", { kind: "manifest", digest: imageA, bytes: 64, layers: [{ digest: layerA, bytes: 128 }, { digest: layerB, bytes: 64 }] }); systemCommand(i, "manifest-b", 500, "$caller", "registry", { kind: "manifest", digest: imageB, bytes: 64, layers: [{ digest: layerA, bytes: 128 }, { digest: layerC, bytes: 256 }] });
  systemCommand(i, "tag-a", 1000, "$caller", "registry", { kind: "tag", tag: "app:latest", digest: imageA });
}
test("registry owns shared immutable blobs and mutable tags; startup pulls only missing node layers", () => {
  const i = systemsFixture({ count: 0, monitoring: false }), q = quantities(); i.arrivals = []; registrySeed(i); const nodes = i.resources.filter((r): r is StartupConfig => r.kind === "artifact-client");
  nodes[0]!.replicas = [{ id: "first", target: "replica-a", reference: "app:latest", at: q.q("start.first", 2000, "us") }, { id: "same", target: "replica-b", reference: imageA, at: q.q("start.same", 4000, "us") }, { id: "shared", target: "replica-c", reference: imageB, at: q.q("start.shared", 6000, "us") }]; nodes[1]!.replicas = [{ id: "fresh-node", target: "replica-d", reference: imageA, at: q.q("start.fresh", 4000, "us") }]; i.ledger.push(...q.ledger);
  const e = systemsRun(i); expect(e.systems.registries[0]!.blobBytes).toBe(448); expect(e.systems.clients[0]!.pulledBytes).toBe(448); expect(e.systems.clients[0]!.reusedLayers).toBe(3); expect(e.systems.clients[1]!.pulledBytes).toBe(192); expect(e.systems.clients.flatMap((n) => n.replicas).every((r) => r.state === "running")).toBe(true); systemsConservation(e);
});
test("registry outage spares running replica and blocks new readiness until authored retry", () => {
  const i = systemsFixture({ count: 0, monitoring: false }), q = quantities(); i.arrivals = []; registrySeed(i); const node = i.resources.find((r): r is StartupConfig => r.kind === "artifact-client")!;
  node.replicas = [{ id: "running", target: "replica-a", reference: imageA, at: q.q("running.at", 2000, "us") }, { id: "new", target: "replica-b", reference: imageB, at: q.q("new.at", 6000, "us") }]; i.networkInterventions.push({ id: "registry-down", kind: "service-state", target: "registry", at: q.q("registry.down", 4000, "us"), duration: q.q("registry.duration", 6000, "us"), alive: false, ready: false }); i.ledger.push(...q.ledger);
  const m = createSystemsModel2(i); m.advanceTo(8000); const cut = m.evidence(); expect(cut.network.endpoints["replica-a"]!.ready).toBe(true); expect(cut.network.endpoints["replica-b"]!.ready).toBe(false); m.advanceTo(m.horizon); const e = m.evidence(); expect(e.network.endpoints["replica-b"]!.ready).toBe(true); systemsConservation(e);
});
test("monitor failure loses observations while real application failures persist; recovery leaves gaps", () => {
  const i = systemsFixture({ count: 15, interval: 1000 }), q = quantities(); i.networkInterventions.push({ id: "app-down", kind: "service-state", target: "app", at: q.q("app.down", 2000, "us"), duration: q.q("app.down.duration", 12000, "us"), alive: false, ready: false }, { id: "db-down", kind: "service-state", target: "db", at: q.q("db.down", 2000, "us"), duration: q.q("db.down.duration", 12000, "us"), alive: false, ready: false }, { id: "monitor-down", kind: "service-state", target: "monitor", at: q.q("monitor.down", 3000, "us"), duration: q.q("monitor.duration", 7000, "us"), alive: false, ready: false }); i.ledger.push(...q.ledger);
  const e = systemsRun(i); expect(e.data.databases[0]!.transactions.committed).toBeLessThan(15); const samples = e.systems.backends[0]!.samples; expect(samples.some((s) => s.measurementAt > 3000 && s.measurementAt < 10000)).toBe(false); expect(samples.some((s) => s.measurementAt > 10000)).toBe(true); systemsConservation(e);
});
test("bounded telemetry buffers drop real samples during export outage; conservation and timestamps persist", () => {
  const i = systemsFixture(), q = quantities(); i.networkInterventions.push({ id: "backend-down", kind: "service-state", target: "telemetry", at: q.q("telemetry.down", 0, "us"), duration: q.q("telemetry.duration", 15000, "us"), alive: false, ready: false }); i.ledger.push(...q.ledger);
  const e = systemsRun(i), monitor = e.systems.monitors[0]!; expect(monitor.dropped).toBeGreaterThan(0); expect(monitor.exported).toBeGreaterThan(0); for (const sample of e.systems.backends[0]!.samples) { expect(sample.measurementAt).toBeLessThanOrEqual(sample.collectedAt); expect(sample.collectedAt).toBeLessThanOrEqual(sample.arrivedAt); } systemsConservation(e);
});
test("TLS trust and validity are checked on new sessions, and observations cannot change ownership", () => {
  const i = systemsFixture({ count: 4, interval: 2000, monitoring: false }), q = quantities(), listener = i.systems.listeners.find((l) => l.resource === "app")!; listener.tls = "required"; listener.certificate = { names: ["app.example"], issuer: "lab", notBefore: q.q("valid.start", 0, "us"), notAfter: q.q("valid.end", 3000, "us") }; i.systems.connections.find((c) => c.path === "$caller:app")!.tls = { mode: "authenticated", serverName: "app.example", trustedIssuers: ["lab"] }; i.ledger.push(...q.ledger);
  const existing = systemsRun(i); expect(existing.counts.completed).toBe(4); const fresh = structuredClone(i); fresh.paths.find((p) => p.id === "$caller:app")!.pool.reuse = false; expect(systemsRun(fresh).counts.completed).toBe(2);
  const m = createSystemsModel2(i); m.advanceTo(2500); const observation = m.evidence(); observation.systems.security.sessions.length = 0; observation.systemConfiguration.resources.length = 0; m.advanceTo(m.horizon); expect(m.evidence()).toEqual(existing); systemsConservation(existing);
  const unknown = systemsFixture(); (unknown.resources.find((r) => r.kind === "monitor") as MonitorConfig).interval = { kind: "unknown", unit: "us", reason: "not authored", provenance: ["missing"] }; expect(() => createSystemsModel2(unknown)).toThrow();
});
test("firewall cache denial creates real extra DB work; cache/DB return needs actual fills", () => {
  const make = (blocked: boolean) => {
    const i = systemsFixture({ count: 12, interval: 500, monitoring: false }), data = dataFixture({ count: 12, interval: 500, horizon: 60000, slots: 32, connections: 16, bandwidth: 100000000, timeout: 50000, raw: 2000, cpu: 10 }), app = i.resources.find((r) => r.id === "app") as ComputeResource;
    app.downstream = "aside"; i.resources.push(data.resources.find((r) => r.id === "aside")!, data.resources.find((r) => r.id === "cache")!); systemPath(i, "app", "aside", 80); systemPath(i, "aside", "cache", 6379); systemPath(i, "aside", "db", 5432);
    if (blocked) i.systems.firewalls[0]!.rules = [denyRule(i, "cache-denied", "cache", 6379)]; return i;
  };
  const normal = systemsRun(make(false)), blocked = systemsRun(make(true)); expect(blocked.data.databases[0]!.logicalReads).toBeGreaterThan(normal.data.databases[0]!.logicalReads); expect(blocked.data.caches[0]!.fills).toBe(0); expect(normal.data.caches[0]!.fills).toBeGreaterThan(0); systemsConservation(normal); systemsConservation(blocked);
});
test("3000 deterministic systems cases conserve caches, flows, artifacts, observations and callers", () => {
  for (let id = 0; id < 3000; id++) {
    const n = (purpose: string, max: number) => 1 + Math.floor(keyedUniform("m2g-sweep", "case", String(id), purpose) * max), i = systemsFixture({ count: n("count", 3), interval: n("arrival", 800), horizon: 6000, ttl: n("ttl", 2000), objectBytes: n("size", 256), coalesce: id % 2 === 0 }), q = quantities("Generated M2G semantic verification; forbidden for physical/provider use");
    const cdn = i.resources.find((r): r is CdnConfig => r.kind === "cdn")!, monitor = i.resources.find((r): r is MonitorConfig => r.kind === "monitor")!; cdn.capacity = q.q("sweep.cdn.cap", n("capacity", 512), "bytes"); monitor.interval = q.q("sweep.collect", n("collect", 500) + 100, "us"); monitor.exportInterval = q.q("sweep.export", n("export", 1500) + 100, "us"); monitor.bufferSamples = q.q("sweep.buffer", n("buffer", 4), "count");
    for (let at = 0; at < 3; at++) systemCommand(i, `cdn-${at}`, at * 1500, "$caller", "cdn", { kind: "get", key: at === 2 && id % 3 === 0 ? "absent" : "asset" });
    if (id % 3 === 0) i.systems.firewalls[0]!.rules = [denyRule(i, "sweep-deny", id % 2 ? "app" : "db", id % 2 ? 80 : 5432)];
    if (id % 4 === 0) { const listener = i.systems.listeners.find((l) => l.resource === "app")!; listener.tls = "required"; listener.certificate = { names: ["app.example"], issuer: "sweep", notBefore: q.q("sweep.cert.start", 0, "us"), notAfter: q.q("sweep.cert.end", n("validity", 7000), "us") }; i.systems.connections.find((c) => c.path === "$caller:app")!.tls = { mode: id % 8 ? "plaintext" : "authenticated", serverName: "app.example", trustedIssuers: [id % 16 ? "wrong" : "sweep"] }; }
    if (id % 5 === 0) { const target = id % 2 ? "telemetry" : "objects"; i.networkInterventions.push({ id: "sweep-outage", kind: "service-state", target, alive: false, ready: false, at: q.q("sweep.outage.at", n("outage", 2000), "us"), duration: q.q("sweep.outage.duration", n("duration", 2000), "us") }); }
    if (id % 6 === 0) { const c = i.systems.connections.find((c) => c.path === "$caller:app")!; c.dns = { name: id % 12 ? "missing.example" : "app.example", resolver: "resolver", routes: [{ address: i.systems.identities.find((x) => x.id === "app")!.address, path: "$caller:app" }] }; i.paths.find((p) => p.id === "$caller:app")!.pool.reuse = id % 12 === 0; }
    if (id % 10 === 0) { registrySeed(i); const node = i.resources.find((r): r is StartupConfig => r.kind === "artifact-client")!; node.replicas = [{ id: "generated", target: "replica-a", reference: id % 20 ? imageA : "absent", at: q.q("sweep.startup", 2000, "us") }]; }
    if (id % 7 === 0) i.systems.interventions.push({ id: "generated-purge", kind: "cdn-purge", target: "cdn", at: q.q("sweep.purge", n("purge", 4000), "us"), key: "asset" });
    i.ledger.push(...q.ledger); const m = createSystemsModel2(i); m.advanceTo(2300); systemsConservation(m.evidence()); m.advanceTo(m.horizon); const e = m.evidence(); systemsConservation(e); expect(e.capture.failure).toBeNull(); if (id % 100 === 0) expect(systemsRun(i, 137)).toEqual(e);
  }
}, 240000);
test("negative DNS cache represents nonexistence, not a cached authority outage", () => {
  const i = systemsFixture({ count: 0, monitoring: false }), q = quantities(); i.arrivals = []; for (const [id, at] of [["negative", 0], ["cached-negative", 800], ["expired-negative", 1500]] as const) systemCommand(i, id, at, "$caller", "resolver", { kind: "resolve", name: "absent.example" }); i.networkInterventions.push({ id: "negative-authority-down", kind: "service-state", target: "authority", alive: false, ready: false, at: q.q("negative.down", 500, "us"), duration: q.q("negative.duration", 5000, "us") }); i.ledger.push(...q.ledger);
  const e = systemsRun(i), replies = Object.fromEntries(e.systems.commands.results.map((r) => [r.id, r.reply as { reason: string }])); expect(replies.negative!.reason).toBe("nxdomain"); expect(replies["cached-negative"]!.reason).toBe("nxdomain"); expect(replies["expired-negative"]!.reason).toBe("command-timeout"); expect(e.systems.resolvers[0]!.hits).toBe(1); systemsConservation(e);
});
test("artifact completion during a compute outage cannot override the fault or lose readiness on recovery", () => {
  const i = systemsFixture({ count: 0, monitoring: false }), q = quantities(); i.arrivals = []; registrySeed(i); const node = i.resources.find((r): r is StartupConfig => r.kind === "artifact-client")!; node.replicas = [{ id: "faulted-compute", target: "replica-a", reference: imageA, at: q.q("faulted.start", 2000, "us") }]; i.networkInterventions.push({ id: "compute-down", kind: "service-state", target: "replica-a", alive: false, ready: false, at: q.q("compute.down", 1000, "us"), duration: q.q("compute.down.duration", 5000, "us") }); i.ledger.push(...q.ledger);
  const m = createSystemsModel2(i); m.advanceTo(4000); expect(m.evidence().network.endpoints["replica-a"]).toEqual({ alive: false, ready: false }); m.advanceTo(m.horizon); expect(m.evidence().network.endpoints["replica-a"]).toEqual({ alive: true, ready: true });
});
test("ambiguous export retries are deduplicated at the backend without claiming confirmed delivery", () => {
  const i = systemsFixture({ count: 0 }), q = quantities(); i.arrivals = []; const path = i.paths.find((p) => p.id === "monitor:telemetry")!; path.pool.responseTimeout = q.q("export.ack.deadline", 500, "us"); i.links.find((l) => l.id === path.response[0])!.propagation = q.q("export.ack.delay", 1000, "us"); i.ledger.push(...q.ledger);
  const e = systemsRun(i), agent = e.systems.monitors[0]!, backend = e.systems.backends[0]!; expect(agent.exported).toBe(0); expect(agent.discardedUnconfirmed).toBeGreaterThan(0); expect(backend.duplicates).toBeGreaterThan(0); expect(backend.samples.length).toBeGreaterThan(0); systemsConservation(e);
});
