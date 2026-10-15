import type { createSystemsModel2 } from "../src/model2/systems/run";
export type SystemsEvidence = ReturnType<ReturnType<typeof createSystemsModel2>["evidence"]>;
export function checkSystems(e: Omit<SystemsEvidence, "workloadVersion"> & { workloadVersion: string }) {
  const require = (condition: boolean, message: string) => { if (!condition) throw Error(message); };
  require(e.counts.offered === e.counts.completed + e.counts.rejected + e.counts.deadlineExceeded + e.counts.abandoned + e.counts.inFlight, "Caller partition");
  for (const r of e.resources) require(r.received === r.admitted + r.rejected && r.admitted === r.completed + r.failed + r.cancelled + r.queued + r.serving + r.waiting, `Station partition ${r.id}`);
  const s = e.systems.security; require(s.attempts === s.established + s.failed + s.cancelled + s.pending && s.established === s.sessions.length + s.closed && s.tlsAttempts === s.tlsEstablished + s.tlsFailed, "Connection/TLS partition");
  for (const f of s.policies) require(f.opened === f.closed + f.flows.length && f.evaluated === f.allowed + f.denied, "Firewall ownership");
  for (const r of e.systems.resolvers) require(r.queries === r.hits + r.misses && r.fills === r.cache.length + r.evictions + r.expirations + r.replaced, "DNS cache ownership");
  for (const c of e.systems.cdns) require(c.storedBytes === c.entries.reduce((n, x) => n + x.bytes, 0) && c.fills === c.entries.length + c.replaced + c.evictions + c.expirations + c.purged, "CDN byte/entry ownership");
  for (const r of e.systems.registries) { require(r.blobBytes === r.blobs.reduce((n, b) => n + b.bytes, 0), "Registry blob bytes"); for (const m of r.manifests) for (const b of m.layers) require(r.blobs.some((x) => x.digest === b.digest && x.bytes === b.bytes), "Manifest blob reference"); for (const tag of Object.values(r.tags)) require(r.manifests.some((m) => m.digest === tag), "Tag reference"); }
  for (const n of e.systems.clients) { require(n.cachedBytes === n.cache.reduce((sum, b) => sum + b.bytes, 0), "Node blob bytes"); for (const r of n.replicas) if (r.state === "running") require(!!r.resolvedDigest && r.requiredLayers.every((b) => n.cache.some((x) => x.digest === b.digest && x.bytes === b.bytes)), "Artifact readiness"); }
  for (const m of e.systems.monitors) { const flying = m.inFlight.flatMap((b) => b.rows); require(m.generated === m.buffered.length + flying.length + m.exported + m.dropped && m.bufferedBytes === m.buffered.reduce((n, r) => n + r.sample.bytes, 0) && m.inFlightBytes === flying.reduce((n, r) => n + r.sample.bytes, 0), "Telemetry ownership"); }
  for (const b of e.systems.backends) require(b.received === b.samples.length + b.duplicates && b.samples.every((s) => s.measurementAt <= s.collectedAt && s.collectedAt <= s.arrivedAt), "Backend observations");
  for (const b of e.asynchronous.brokers) require(b.accepted === b.ready + b.scheduled + b.inFlight + b.acknowledged + b.deadLettered + b.expired + b.discarded, "Queue ownership");
  for (const o of e.asynchronous.objects) require(o.storedBytes === o.objects.reduce((n, x) => n + x.bytes, 0), "Object bytes");
}
