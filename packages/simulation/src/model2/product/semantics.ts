import { requireKnown } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";
import type { SemanticSpec } from "./contracts";
const fields: Record<string, string[]> = {
  compute: ["cores", "workers", "scheduler", "quota", "memory", "queueCapacity", "profiles", "context", "cancellation", "downstream"],
  relational: ["semantics", "execution", "maxSessions", "activeTransactions", "pendingQueries", "keys", "initial", "plans"],
  cache: ["semantics", "execution", "capacity", "entryOverhead", "policy", "ttl", "initial", "commandCpu"],
  "cache-aside": ["execution", "cache", "database", "keys", "access", "coalesce", "onCacheFailure", "invalidateWrites", "operations"],
  "load-balancer": ["backends", "policy", "maxOutstanding", "maxPending", "pendingTimeout", "health", "retry"],
  "dns-authority": ["records", "negativeTtl"], "dns-resolver": ["authority", "cacheEntries"],
  cdn: ["origin", "namespace", "keys", "capacity", "ttl", "coalesce", "maxWaiters"],
  registry: ["store", "namespace"], "artifact-client": ["registry", "cacheBytes", "attempts", "backoff", "replicas", "initialLayers"],
  monitor: ["targets", "backend", "operation", "interval", "exportInterval", "freshFor", "sampleBytes", "bufferBytes", "bufferSamples", "batchSamples", "attempts"],
  "telemetry-backend": ["samples"],
  "object-store": ["profile", "capacity", "initial"],
  "delivery-queue": ["profile", "capacityMessages", "capacityBytes", "lease", "retention", "maxAttempts", "dlqMessages", "dlqBytes", "deduplicatePublishes", "consumers"],
};
fields["async-publisher"] = ["execution", "broker", "store", "namespace", "objectBytes", "messageBytes", "delay", "publishAttempts"];
fields["async-worker"] = ["execution", "broker", "store", "database", "databaseOperation", "databaseKey", "namespace", "concurrency", "prefetch", "pollInterval", "cpu", "blockingWait", "ackDelay", "resultBytes", "idempotency", "poisonKeys"];
const commandKinds = new Set(["dns-authority", "dns-resolver", "cdn", "registry", "artifact-client", "monitor", "telemetry-backend", "object-store", "delivery-queue"]);
export function validateMaterializedSemantics(input: SystemsInput, edges: SemanticSpec["edges"]) {
  const resources = new Map(input.resources.map((r) => [r.id, r]));
  const paths = new Map(input.paths.map((p) => [p.id, p])), pairs = new Set(input.paths.map((p) => JSON.stringify([p.source, p.target]))), dials = new Map(input.systems.connections.map((d) => [d.path, d]));
  const listeners = new Set(input.systems.listeners.map((l) => JSON.stringify([l.resource, l.protocol, requireKnown(l.port, "count")])));
  for (const r of input.resources) {
    const allowed = new Set(["id", "kind", ...(fields[r.kind] ?? []), ...(commandKinds.has(r.kind) ? ["execution", "concurrency", "pending", "timeout", "demands"] : [])]);
    for (const key of Object.keys(r)) if (!allowed.has(key)) throw Error(`Unsupported resource setting ${r.id}.${key}`);
  }
  for (const p of input.paths) {
    const dial = dials.get(p.id)!;
    if (!listeners.has(JSON.stringify([p.target, dial.protocol, requireKnown(dial.port, "count")]))) throw Error(`Missing listener for ${p.id} -> ${p.target}; port permission is not a service`);
  }
  for (const e of edges) {
    if (!["queue-poll", "dependency", "routing", "origin", "dns-query", "artifact", "monitor-target", "telemetry-export", "consumer", "policy-attachment"].includes(e.purpose)) throw Error(`Unsupported edge intent ${e.id}`);
    if (e.purpose === "policy-attachment" && !input.systems.connections.some((d) => d.firewalls.includes(e.source) && (paths.get(d.path)!.target === e.target || paths.get(d.path)!.target.startsWith(e.target + "#")))) throw Error(`Policy attachment ${e.id} has no actual admitted path policy`);
  }
  // Every materialized dependency is backed by a path; these are relationships, not pairwise physics.
  for (const r of resources.values()) {
    const targets = r.kind === "compute" ? r.downstream ? [r.downstream] : [] : r.kind === "cache-aside" ? [r.cache, r.database] : r.kind === "dns-resolver" ? [r.authority] : r.kind === "cdn" ? [r.origin] : r.kind === "registry" ? [r.store] : r.kind === "artifact-client" ? [r.registry] : r.kind === "monitor" ? [...r.targets, r.backend] : r.kind === "load-balancer" ? r.backends : [];
    for (const target of targets) if (!pairs.has(JSON.stringify([r.id, target]))) throw Error(`Missing dependency/origin/observation transport ${r.id} -> ${target}`);
  }
}
