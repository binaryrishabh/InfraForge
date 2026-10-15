import { writeFileSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { systemsFixture, systemCommand, systemPath } from "../../packages/simulation/tests/systemsFixture";
import { quantities } from "../../packages/simulation/tests/workloadFixture";
import { createSystemsModel2 } from "../../packages/simulation/src/model2/systems/run";
import type { ObjectConfig } from "../../packages/simulation/src/model2/async/contracts";
import type { AuthorityConfig, CdnConfig, MonitorConfig, ResolverConfig, StartupConfig, SystemsInput } from "../../packages/simulation/src/model2/systems/contracts";
import type { ComputeResource } from "../../packages/simulation/src/model2/compute/contracts";
import { checkSystems } from "./systems-invariants";
import { blockRule } from "./systems-proofs";
const sourceRoot = fileURLToPath(new URL("../../packages/simulation/src/model2", import.meta.url)), sourceFiles: string[] = [];
const walk = (directory: string) => { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = resolve(directory, entry.name); if (entry.isDirectory()) walk(path); else if (path.endsWith(".ts")) sourceFiles.push(path); } }; walk(sourceRoot);
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const report = { scope: "Single local executor samples with synthetic authored resources; sparse evidence sampling; heap includes earlier cases/GC; no physical resource timing/capacity claim", sourceHash: sha(readFileSync(fileURLToPath(import.meta.url))), engineHash: sha(sourceFiles.sort().map((path) => `${relative(sourceRoot, path).replaceAll("\\", "/")}:${sha(readFileSync(path))}`).join("\n")), complete: false, cases: [] as unknown[] };
for (const scenario of ["dns-cache", "cdn-objects", "firewall-rules", "connections", "registry-graph", "telemetry-streams", "long-recovery"]) {
  const setupStart = performance.now(), i = systemsFixture({ count: scenario === "connections" || scenario === "firewall-rules" ? 1000 : scenario === "long-recovery" ? 500 : 0, interval: scenario === "firewall-rules" ? 100 : scenario === "long-recovery" ? 200 : 1, horizon: scenario === "long-recovery" ? 1000000 : 600000, monitoring: scenario === "telemetry-streams" }), q = quantities("M2G executor performance stimulus; all resource values synthetic, forbidden from physical/provider/Free Mode use");
  i.sampleInterval = q.q("perf.g.samples", 500000, "us"); if (!["connections", "firewall-rules", "long-recovery"].includes(scenario)) i.arrivals = [];
  for (const r of i.resources) if (r.kind === "async-worker") r.pollInterval = q.q("perf.g.poll", 100000, "us");
  if (scenario === "dns-cache") {
    const authority = i.resources.find((r): r is AuthorityConfig => r.kind === "dns-authority")!, resolver = i.resources.find((r): r is ResolverConfig => r.kind === "dns-resolver")!; authority.records = []; resolver.cacheEntries = q.q("perf.dns.entries", 10000, "count"); const ttl = q.q("perf.dns.ttl", 1000000000, "us");
    for (let n = 0; n < 5000; n++) { authority.records.push({ name: `name${n}.example`, type: "A", addresses: ["192.0.2.1"], ttl, generation: 1 }); systemCommand(i, `dns-${n}`, n * 100, "$caller", "resolver", { kind: "resolve", name: `name${n}.example` }); }
  }
  if (scenario === "cdn-objects") {
    const store = i.resources.find((r): r is ObjectConfig => r.kind === "object-store")!, cdn = i.resources.find((r): r is CdnConfig => r.kind === "cdn")!, bytes = q.q("perf.cdn.objectBytes", 256, "bytes"); cdn.ttl = q.q("perf.cdn.ttl", 1000000000, "us"); cdn.capacity = q.q("perf.cdn.capacity", 2000000, "bytes");
    for (let n = 0; n < 5000; n++) { store.initial.push({ namespace: "web", key: `object-${n}`, generation: n + 2, content: `content-${n}`, bytes }); systemCommand(i, `cdn-${n}`, n * 100, "$caller", "cdn", { kind: "get", key: `object-${n}` }); }
  }
  if (scenario === "firewall-rules" || scenario === "connections") {
    (i.resources.find((r) => r.id === "app") as ComputeResource).downstream = undefined;
    const path = i.paths.find((p) => p.id === "$caller:app")!; path.pool.reuse = false; path.pool.maxConnections = q.q("perf.g.connections", 512, "count"); path.pool.pending = q.q("perf.g.pending", 10000, "count");
    if (scenario === "firewall-rules") for (let n = 0; n < 10000; n++) { const rule = blockRule(i, `rule-${n}`, "app", 8080); rule.priority = q.q(`perf.rule.${n}.priority`, n, "count"); i.systems.firewalls[0]!.rules.push(rule); }
  }
  if (scenario === "registry-graph") {
    const digest = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;
    for (let n = 0; n < 1024; n++) systemCommand(i, `blob-${n}`, n * 100, "$caller", "registry", { kind: "upload", digest: digest(n), bytes: 128 }, 128);
    for (let n = 0; n < 256; n++) { systemCommand(i, `manifest-${n}`, 150000 + n * 100, "$caller", "registry", { kind: "manifest", digest: digest(n + 10000), bytes: 128, layers: [{ digest: digest(0), bytes: 128 }, { digest: digest(n + 1), bytes: 128 }] }); systemCommand(i, `tag-${n}`, 200000, "$caller", "registry", { kind: "tag", tag: `image-${n}`, digest: digest(n + 10000) }); }
    const node = i.resources.find((r): r is StartupConfig => r.kind === "artifact-client")!; node.replicas = [{ id: "graph-startup", target: "replica-a", reference: "image-0", at: q.q("perf.registry.start", 250000, "us") }];
  }
  if (scenario === "telemetry-streams") {
    const app = i.resources.find((r) => r.id === "app") as ComputeResource, monitor = i.resources.find((r): r is MonitorConfig => r.kind === "monitor")!; monitor.targets = []; i.systems.instrumentation = []; monitor.execution.cores = q.q("perf.monitor.cores", 4, "cores"); monitor.concurrency = q.q("perf.monitor.concurrency", 128, "count"); monitor.interval = q.q("perf.monitor.interval", 5000, "us"); monitor.exportInterval = q.q("perf.monitor.exportInterval", 5000, "us"); monitor.bufferSamples = q.q("perf.monitor.samples", 1000, "count"); monitor.bufferBytes = q.q("perf.monitor.bytes", 128000, "bytes"); monitor.batchSamples = q.q("perf.monitor.batch", 128, "count");
    for (let n = 0; n < 100; n++) { const id = `observed-${n}`; i.resources.push({ ...structuredClone(app), id, downstream: undefined }); systemPath(i, "monitor", id, 80); monitor.targets.push(id); i.systems.instrumentation.push({ target: id, bytes: monitor.sampleBytes }); }
    i.networkInterventions.push({ id: "collector-outage", kind: "service-state", target: "telemetry", alive: false, ready: false, at: q.q("perf.collector.at", 100000, "us"), duration: q.q("perf.collector.duration", 200000, "us") });
  }
  if (scenario === "long-recovery") i.networkInterventions.push({ id: "dependency-outage", kind: "service-state", target: "db", alive: false, ready: false, at: q.q("perf.recovery.at", 10000, "us"), duration: q.q("perf.recovery.duration", 300000, "us") });
  i.ledger.push(...q.ledger); const runtime = createSystemsModel2(i), setupMs = performance.now() - setupStart, start = performance.now(); runtime.advanceTo(runtime.horizon); const executionMs = performance.now() - start, evidenceStart = performance.now(), e = runtime.evidence(), evidenceMs = performance.now() - evidenceStart; checkSystems(e); const serializeStart = performance.now(), serialized = JSON.stringify(e), serializeMs = performance.now() - serializeStart;
  const row = { scenario, inputHash: sha(JSON.stringify(i)), setupMs, executionMs, evidenceMs, serializeMs, evidenceBytes: Buffer.byteLength(serialized), heapUsed: process.memoryUsage().heapUsed, virtualHorizonUs: runtime.horizon, execution: e.execution, counts: e.counts, dns: e.systems.resolvers.map((r) => ({ entries: r.cache.length, queries: r.queries, hits: r.hits })), cdn: e.systems.cdns.map((c) => ({ entries: c.entries.length, bytes: c.storedBytes, requests: c.originRequests })), security: { attempts: e.systems.security.attempts, failed: e.systems.security.failed, sessions: e.systems.security.sessions.length, policies: e.systems.security.policies.map((p) => ({ rules: p.rules.length, opened: p.opened, examined: p.rulesExamined })) }, registry: e.systems.registries.map((r) => ({ blobs: r.blobs.length, blobBytes: r.blobBytes, manifests: r.manifests.length, tags: Object.keys(r.tags).length })), telemetry: e.systems.monitors.map((m) => ({ generated: m.generated, exported: m.exported, dropped: m.dropped, droppedBeforeExport: m.droppedBeforeExport, discardedUnconfirmed: m.discardedUnconfirmed, buffered: m.buffered.length, inFlight: m.inFlight.length })), queue: e.asynchronous.brokers.map((b) => ({ accepted: b.accepted, ready: b.ready, inFlight: b.inFlight, acknowledged: b.acknowledged, deliveries: b.deliveries, dlq: b.deadLettered })), ledger: q.ledger };
  report.cases.push(row); writeFileSync(new URL("../../docs/reality/m2g-performance.json", import.meta.url), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ scenario, setupMs, executionMs, evidenceMs, serializeMs, outcome: row.counts }));
}
report.complete = true;
writeFileSync(new URL("../../docs/reality/m2g-performance.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
