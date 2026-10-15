import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import { validateAsync } from "../async/validate";
import type { AsyncInput } from "../async/contracts";
import type { AddressRecord, FirewallRule, Scope, SystemResource, SystemsInput } from "./contracts";
import { SYSTEM_LIMITS as caps } from "./policy";
import { ipv4 } from "./security";
import { dnsName } from "./dns";
import { micros } from "../time";
export const isSystem = (r: { kind: string }): r is SystemResource => ["dns-authority", "dns-resolver", "cdn", "registry", "artifact-client", "monitor", "telemetry-backend"].includes(r.kind);
export const asyncAdapter = (i: SystemsInput): AsyncInput => ({ ...i, workloadVersion: "m2f/1", resources: i.resources.map((r) => isSystem(r) ? { ...r.execution, id: r.id, downstream: undefined } : r) });
export function validateSystems(i: SystemsInput) {
  if (i.workloadVersion !== "m2g/1" || i.resources.length > caps.resources || !i.systems || i.systems.commands.length > caps.entries || i.systems.interventions.length > caps.entries || i.systems.listeners.length > caps.entries || i.systems.connections.length !== i.paths.length || i.systems.identities.length > caps.entries || i.systems.instrumentation.length > caps.targets || i.systems.firewalls.length > caps.resources) throw Error("Invalid systems revision/budget");
  validateAsync(asyncAdapter(i));
  const ledger = new Map(i.ledger.map((e) => [e.id, e.quantity])), horizon = requireKnown(i.horizon, "us"), resources = new Map(i.resources.map((r) => [r.id, r])), paths = new Map(i.paths.map((p) => [p.id, p])), identities = new Map(i.systems.identities.map((x) => [x.id, x]));
  const n = <U extends Unit>(q: Quantity<U>, unit: U, min = 0, max = Number.MAX_SAFE_INTEGER, integer = true) => { const v = requireKnown(q, unit); if (v < min || v > max || (integer && !Number.isSafeInteger(v)) || !q.provenance.length || q.provenance.some((id) => { const row = ledger.get(id); return row?.kind !== "known" || row.unit !== unit || row.value !== v; })) throw Error("Invalid systems quantity/provenance"); return v; };
  const key = (s: string) => typeof s === "string" && s.length > 0 && s.length <= 1024;
  const name = (s: string) => typeof s === "string" && s.length <= caps.nameCharacters && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.?$/i.test(s) && dnsName(s).split(".").every((p) => p.length > 0 && p.length <= 63);
  const unique = (xs: string[]) => new Set(xs).size === xs.length;
  const path = (source: string, target: string) => { const p = i.paths.find((p) => p.source === source && p.target === target); if (!p) throw Error(`Missing systems path ${source}->${target}`); return p; };
  const record = (r: AddressRecord) => { if (!name(r.name) || r.type !== "A" || !Number.isSafeInteger(r.generation) || r.generation < 1 || !r.addresses.length || r.addresses.length > caps.targets || !unique(r.addresses) || r.addresses.some((a) => ipv4(a) === undefined)) throw Error("Invalid DNS A record"); micros(horizon + n(r.ttl, "us")); };
  const scope = (s: Scope) => {
    if (!["any", "identity", "zone", "cidr"].includes(s.kind)) throw Error("Unknown firewall scope");
    if (s.kind === "identity" && !identities.has(s.value!)) throw Error("Unknown policy identity");
    if (s.kind === "zone" && !["internal", "external"].includes(s.value!)) throw Error("Unknown network zone");
    if (s.kind === "cidr") { const [address, prefix, extra] = (s.value ?? "").split("/"); if (ipv4(address!) === undefined || !/^\d{1,2}$/.test(prefix ?? "") || +prefix! > 32 || extra !== undefined) throw Error("Invalid IPv4 CIDR"); }
  };
  const rules = (rows: FirewallRule[]) => { if (rows.length > caps.rules || !unique(rows.map((r) => r.id))) throw Error("Firewall rule budget/identity"); for (const r of rows) { if (!key(r.id) || !["allow", "deny"].includes(r.action) || !["ingress", "egress"].includes(r.direction) || r.protocol !== "tcp" || n(r.fromPort, "count", 1, 65535) > n(r.toPort, "count", 1, 65535)) throw Error("Invalid ordered TCP rule"); n(r.priority, "count"); scope(r.source); scope(r.destination); } };
  if (!unique(i.systems.identities.map((x) => x.id)) || !unique(i.systems.identities.map((x) => x.address)) || !unique(i.systems.listeners.map((l) => JSON.stringify([l.resource, l.protocol, requireKnown(l.port, "count")]))) || !unique(i.systems.connections.map((c) => c.path)) || !unique(i.systems.firewalls.map((f) => f.id)) || !unique(i.systems.instrumentation.map((p) => p.target))) throw Error("Duplicate systems identity");
  for (const identity of identities.values()) if (!key(identity.id) || ipv4(identity.address) === undefined || !["external", "internal"].includes(identity.zone) || (identity.id !== "$caller" && !resources.has(identity.id))) throw Error("Invalid network identity");
  if (!i.operations.some((o) => o.id === i.systems.operation)) throw Error("Missing control operation");
  for (const r of i.resources) if (isSystem(r)) {
    if (r.execution.id !== r.id || r.execution.downstream || r.execution.quota || r.execution.memory.coverage !== "partial" || r.execution.memory.policy !== "observe" || Object.keys(r.execution.memory).some((k) => !["coverage", "policy"].includes(k)) || i.faults.some((f) => f.target === r.id) || i.interventions.some((f) => f.target === r.id) || i.dataInterventions.some((f) => f.target === r.id)) throw Error("Systems resource owns command/fault policy; physical memory Unknown");
    n(r.concurrency, "count", 1, caps.targets); n(r.pending, "count", 0, caps.entries); micros(horizon + n(r.timeout, "us", 1));
    const commands = r.kind === "dns-authority" || r.kind === "dns-resolver" ? ["resolve"] : r.kind === "cdn" ? ["get"] : r.kind === "registry" ? ["upload", "manifest", "tag", "resolve", "blob"] : r.kind === "artifact-client" ? ["start"] : r.kind === "monitor" ? ["collect", "export"] : ["export"];
    if (Object.keys(r.demands).length !== commands.length) throw Error("Unknown/missing systems command demand");
    for (const command of commands) { const d = r.demands[command]; if (!d) throw Error("Missing systems demand"); n(d.cpu, "cpu-us", Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, false); micros(horizon + n(d.wait, "us")); }
    if (r.kind === "dns-authority") { if (r.records.length > caps.entries || !unique(r.records.map((x) => dnsName(x.name)))) throw Error("DNS record budget"); r.records.forEach(record); micros(horizon + n(r.negativeTtl, "us")); }
    if (r.kind === "dns-resolver") { if (resources.get(r.authority)?.kind !== "dns-authority") throw Error("Missing authoritative DNS owner"); path(r.id, r.authority); n(r.cacheEntries, "count", 1, caps.entries); }
    if (r.kind === "cdn") { if (resources.get(r.origin)?.kind !== "object-store" || !key(r.namespace) || typeof r.coalesce !== "boolean" || Object.values(r.keys).some((k) => !key(k)) || Object.keys(r.keys).some((o) => !i.operations.some((x) => x.id === o))) throw Error("CDN origin/key contract"); path(r.id, r.origin); n(r.capacity, "bytes"); micros(horizon + n(r.ttl, "us")); n(r.maxWaiters, "count", 1, caps.entries); }
    if (r.kind === "registry") { if (resources.get(r.store)?.kind !== "object-store" || !key(r.namespace)) throw Error("Registry object owner"); path(r.id, r.store); }
    if (r.kind === "artifact-client") {
      if (resources.get(r.registry)?.kind !== "registry" || r.replicas.length > caps.targets || !unique(r.replicas.map((x) => x.id)) || !unique(r.replicas.map((x) => x.target))) throw Error("Registry startup contract"); path(r.id, r.registry); n(r.cacheBytes, "bytes"); n(r.attempts, "count", 1, caps.attempts); micros(horizon + n(r.backoff, "us", 1));
      const initial = r.initialLayers ?? []; if (initial.length > caps.entries || !unique(initial.map((b) => b.digest)) || initial.some((b) => !/^sha256:[a-f0-9]{64}$/.test(b.digest)) || initial.reduce((sum, b) => sum + n(b.bytes, "bytes"), 0) > n(r.cacheBytes, "bytes")) throw Error("Invalid authored initial layer ownership/capacity");
      for (const replica of r.replicas) { if (!key(replica.id) || !key(replica.reference) || resources.get(replica.target)?.kind !== "compute" || !i.endpoints[replica.target]!.alive) throw Error("Startup compute target"); n(replica.at, "us", 0, horizon); }
    }
    if (r.kind === "monitor") {
      if (r.targets.length > caps.targets || !unique(r.targets) || resources.get(r.backend)?.kind !== "telemetry-backend" || !i.operations.some((o) => o.id === r.operation)) throw Error("Monitoring target/backend contract"); path(r.id, r.backend);
      for (const target of r.targets) { path(r.id, target); if (!i.systems.instrumentation.some((p) => p.target === target && requireKnown(p.bytes, "bytes") === requireKnown(r.sampleBytes, "bytes"))) throw Error("Missing explicit target instrumentation"); }
      for (const time of [r.interval, r.exportInterval, r.freshFor]) micros(horizon + n(time, "us", 1)); n(r.sampleBytes, "bytes", 1); n(r.bufferBytes, "bytes"); n(r.bufferSamples, "count", 1, caps.entries); n(r.batchSamples, "count", 1, caps.entries); n(r.attempts, "count", 1, caps.attempts);
    }
    if (r.kind === "telemetry-backend") n(r.samples, "count", 1, caps.entries);
  }
  const startupTargets = i.resources.filter((r): r is Extract<SystemResource, { kind: "artifact-client" }> => r.kind === "artifact-client").flatMap((r) => r.replicas.map((x) => x.target)); if (!unique(startupTargets)) throw Error("Compute has multiple artifact readiness owners");
  for (const p of i.systems.instrumentation) { if (!resources.has(p.target)) throw Error("Unknown instrumentation target"); n(p.bytes, "bytes", 1); }
  for (const f of i.systems.firewalls) { if (!key(f.id) || f.profile !== "ordered-stateful/1" || !["allow", "deny"].includes(f.default)) throw Error("Invalid firewall profile"); n(f.maxFlows, "count", 1, caps.flows); rules(f.rules); }
  for (const listener of i.systems.listeners) {
    if (!resources.has(listener.resource) || listener.protocol !== "tcp" || !["plaintext", "required", "optional"].includes(listener.tls)) throw Error("Invalid listener"); n(listener.port, "count", 1, 65535);
    const cert = listener.certificate; if (cert && (!key(cert.issuer) || !cert.names.length || !unique(cert.names) || cert.names.some((s) => !name(s) || s !== dnsName(s)) || n(cert.notBefore, "us") >= n(cert.notAfter, "us"))) throw Error("Invalid certificate assertions");
  }
  for (const c of i.systems.connections) {
    const p = paths.get(c.path); if (!p || !identities.has(p.source) || !identities.has(p.target) || c.protocol !== "tcp" || !unique(c.firewalls) || c.firewalls.some((f) => !i.systems.firewalls.some((x) => x.id === f)) || !["plaintext", "authenticated"].includes(c.tls.mode) || (c.tls.mode === "authenticated" && (!name(c.tls.serverName!) || !c.tls.trustedIssuers.length))) throw Error("Invalid connection security contract"); n(c.port, "count", 1, 65535);
    if (c.dns) {
      if (!name(c.dns.name) || resources.get(c.dns.resolver)?.kind !== "dns-resolver" || !c.dns.routes.length || c.dns.routes.length > caps.targets || !unique(c.dns.routes.map((r) => r.address))) throw Error("Invalid DNS connection dependency");
      const bootstrap = path(p.source, c.dns.resolver); if (i.systems.connections.find((x) => x.path === bootstrap.id)?.dns) throw Error("DNS bootstrap cannot require DNS");
      for (const route of c.dns.routes) { const target = paths.get(route.path); if (!target || target.source !== p.source || identities.get(target.target)?.address !== route.address) throw Error("DNS answer has no authored destination route"); }
    }
  }
  for (const r of i.resources) if (r.kind === "dns-resolver" && i.systems.connections.find((c) => c.path === path(r.id, r.authority).id)?.dns) throw Error("Authoritative bootstrap must use an explicit address");
  const ids = new Set<string>();
  const dnsGenerations = new Map(i.resources.flatMap((r) => r.kind === "dns-authority" ? r.records.map((record) => [JSON.stringify([r.id, dnsName(record.name)]), record.generation] as const) : []));
  for (const f of [...i.systems.interventions].sort((a, b) => requireKnown(a.at, "us") - requireKnown(b.at, "us") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!key(f.id) || ids.has(f.id)) throw Error("Duplicate systems intervention"); ids.add(f.id); n(f.at, "us", 0, horizon);
    if (f.kind === "dns-record") { const authority = resources.get(f.target); if (authority?.kind !== "dns-authority") throw Error("DNS record update owner"); record(f.record); const key = JSON.stringify([f.target, dnsName(f.record.name)]); if (f.record.generation <= (dnsGenerations.get(key) ?? 0) || (!dnsGenerations.has(key) && dnsGenerations.size >= caps.entries)) throw Error("DNS update generation/budget"); dnsGenerations.set(key, f.record.generation); }
    else if (f.kind === "cdn-purge") { if (resources.get(f.target)?.kind !== "cdn" || (f.key !== undefined && !key(f.key))) throw Error("CDN purge owner"); }
    else if (f.kind === "firewall-rules") { if (!i.systems.firewalls.some((x) => x.id === f.target)) throw Error("Firewall update owner"); rules(f.rules); }
    else throw Error("Unsupported systems intervention");
  }
  ids.clear();
  let inputFields = 0;
  const bounded = (value: unknown, depth = 0) => { if (++inputFields > caps.inputFields || depth > caps.inputDepth) throw Error("Command payload budget"); if (typeof value === "string" && value.length > caps.textCharacters) throw Error("Command text budget"); if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw Error("Invalid command workload number"); if (value && typeof value === "object") { const children = Object.values(value); if (children.length > caps.entries) throw Error("Command collection budget"); for (const child of children) bounded(child, depth + 1); } };
  for (const command of i.systems.commands) {
    if (!key(command.id) || ids.has(command.id) || !key(command.provenance) || !i.operations.some((o) => o.id === command.operation) || !command.request || typeof command.request !== "object" || typeof (command.request as { kind?: string }).kind !== "string") throw Error("Invalid authored command workload"); ids.add(command.id); path(command.source, command.target); n(command.at, "us", 0, horizon); n(command.bodyBytes, "bytes");
    bounded(command.request);
    const payload = command.request as { kind: string; bytes?: number };
    if (!Number.isSafeInteger(requireKnown(command.bodyBytes, "bytes") * i.limits.maxEvents) || (["upload", "manifest"].includes(payload.kind) && payload.bytes !== requireKnown(command.bodyBytes, "bytes"))) throw Error("Command body-byte ownership/overflow");
  }
}
