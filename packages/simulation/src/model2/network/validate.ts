import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import { micros } from "../time";
import type { ComputeInput } from "../compute/contracts";
import type { NetworkInput } from "./contracts";
import { RETRYABLE_FAILURES } from "./contracts";
import { NETWORK_LIMITS as caps } from "./policy";

export function computeAdapter(input: NetworkInput): ComputeInput {
  return { ...input, workloadVersion: "m2c/1", resources: input.resources.map((r) => r.kind === "load-balancer" ? { id: r.id, kind: "router", backends: r.backends } : r) };
}
export function validateNetwork(input: NetworkInput) {
  if (input.workloadVersion !== "m2d/1" || input.links.length > caps.links || input.paths.length > caps.paths || input.networkInterventions.length > caps.interventions) throw new Error("Invalid network revision/structural budget");
  const horizon = requireKnown(input.horizon, "us"), entries = new Map(input.ledger.map((e) => [e.id, e.quantity]));
  const number = <U extends Unit>(q: Quantity<U>, unit: U, min = 0, integer = true) => {
    const n = requireKnown(q, unit);
    if (n < min || (integer && !Number.isSafeInteger(n))) throw new Error(`Invalid network ${unit}`);
    for (const id of q.provenance) { const e = entries.get(id); if (!e || e.kind !== "known" || e.unit !== unit || e.value !== n) throw new Error(`Missing exact network provenance: ${id}`); }
    return n;
  };
  const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length || ids.some((id) => !id || id.length > caps.identityCharacters)) throw new Error("Duplicate/invalid network identity"); };
  unique(input.links.map((l) => l.id)); unique(input.paths.map((p) => p.id)); unique(input.networkInterventions.map((i) => i.id));
  const links = new Map(input.links.map((l) => [l.id, l])), pairs = new Map(input.paths.map((p) => [JSON.stringify([p.source, p.target]), p]));
  const resourceIds = new Set(input.resources.map((r) => r.id)), endpoints = new Map(Object.entries(input.endpoints));
  if (endpoints.size !== resourceIds.size || [...endpoints.keys()].some((id) => !resourceIds.has(id))) throw new Error("Endpoint inventory must match resources");
  if (pairs.size !== input.paths.length) throw new Error("Ambiguous path pair");
  for (const l of input.links) {
    if (l.policy !== "fifo-message/1" || !l.from || !l.to) throw new Error("Invalid directed link policy/endpoints");
    const rate = number(l.bandwidth, "bytes/s", Number.MIN_VALUE, false); number(l.bufferBytes, "bytes"); number(l.propagation, "us");
    if (!Number.isFinite(rate * horizon)) throw new Error("Link accounting overflow");
  }
  for (const r of input.resources) {
    const endpoint = endpoints.get(r.id);
    if (!endpoint || typeof endpoint.alive !== "boolean" || typeof endpoint.ready !== "boolean") throw new Error("Explicit endpoint existence/readiness required");
    if (r.kind !== "compute" && r.kind !== "database" && r.kind !== "load-balancer") throw new Error("Unsupported network resource");
    if ((!endpoint.alive || input.networkInterventions.some((i) => i.kind === "service-state" && i.target === r.id && i.alive !== endpoint.alive)) && input.faults.some((f) => f.target === r.id)) throw new Error("Endpoint suspension cannot overlap an independent service pause policy");
    for (const target of r.kind === "load-balancer" ? r.backends : r.downstream ? [r.downstream] : []) if (!pairs.has(JSON.stringify([r.id, target]))) throw new Error("Missing dependency transport path");
    if (r.kind === "compute") for (const target of Object.values(r.downstreamByOperation ?? {})) if (!pairs.has(JSON.stringify([r.id, target]))) throw Error("Missing operation dependency transport path");
  }
  for (const op of input.operations) if (!pairs.has(JSON.stringify(["$caller", op.entry]))) throw new Error("Missing caller transport path");
  for (const p of input.paths) {
    if (!(p.source === "$caller" || resourceIds.has(p.source)) || !resourceIds.has(p.target)) throw new Error("Unknown path endpoint");
    for (const [ids, source, target] of [[p.request, p.source, p.target], [p.response, p.target, p.source]] as const) {
      if (!ids.length || ids.length > caps.hops || new Set(ids).size !== ids.length) throw new Error("Invalid transport hop budget/loop");
      let node = source;
      for (const id of ids) { const l = links.get(id); if (!l || l.from !== node) throw new Error("Discontinuous directed path"); node = l.to; }
      if (node !== target) throw new Error("Wrong path destination");
    }
    for (const op of input.operations) {
      const b = p.bytes[op.id]; if (!b) throw new Error("Unknown request/response byte demand");
      for (const [q, ids] of [[b.request, p.request], [b.response, p.response]] as const) {
        const n = number(q, "bytes"); if (!Number.isSafeInteger(n * input.limits.maxEvents)) throw new Error("Byte conservation counter overflow");
        for (const id of ids) {
          const l = links.get(id)!;
          const rates = [l.bandwidth, ...input.networkInterventions.filter((i) => i.kind === "bandwidth" && i.target === id).map((i) => i.kind === "bandwidth" ? i.bandwidth : l.bandwidth)];
          const delay = Math.max(0, ...input.networkInterventions.filter((i) => i.kind === "delay" && i.target === id).map((i) => i.kind === "delay" ? requireKnown(i.delay, "us") : 0));
          for (const rate of rates) if (requireKnown(rate, "bytes/s") > 0) micros(horizon + Math.ceil(n / (requireKnown(rate, "bytes/s") / 1000000)) + requireKnown(l.propagation, "us") + delay);
        }
      }
    }
    const c = p.pool, max = number(c.maxConnections, "count", 1), streams = number(c.streams, "count", 1);
    if (max > caps.connectionsPerPool || streams > caps.streamsPerConnection || number(c.pending, "count") > caps.pendingPerPool || !["serial", "multiplexed"].includes(c.mode) || typeof c.reuse !== "boolean" || (c.mode === "serial" && streams !== 1) || (!c.reuse && streams !== 1) || !["detach", "request-cancellation"].includes(c.remoteCancellation)) throw new Error("Invalid connection policy/budget");
    number(c.establish, "us"); for (const t of [c.acquireTimeout, c.connectTimeout, c.responseTimeout, ...(c.idleTimeout ? [c.idleTimeout] : [])]) micros(horizon + number(t, "us", 1));
  }
  let probes = 0;
  for (const r of input.resources) if (r.kind === "load-balancer") {
    if (!["round-robin", "least-outstanding"].includes(r.policy) || !["eligible", "ineligible"].includes(r.health.initial) || !input.operations.some((o) => o.id === r.health.operation)) throw new Error("Invalid LB routing/health policy");
    number(r.maxOutstanding, "count", 1); number(r.maxPending, "count"); number(r.pendingTimeout, "us", 1);
    const interval = number(r.health.interval, "us", 1), timeout = number(r.health.timeout, "us", 1);
    number(r.health.healthy, "count", 1); number(r.health.unhealthy, "count", 1);
    if (timeout > interval) throw new Error("Overlapping health probes unsupported");
    probes += (1 + Math.floor(horizon / interval)) * r.backends.length;
    if (r.retry) {
      const tries = number(r.retry.maxAttempts, "count", 1); number(r.retry.maxConcurrentRetries, "count"); number(r.retry.backoff, "us");
      if (tries > caps.attempts || number(r.retry.jitter, "ratio", 0, false) > 1 || typeof r.retry.allowAmbiguousNonIdempotent !== "boolean" || new Set(r.retry.retryOn).size !== r.retry.retryOn.length || r.retry.retryOn.some((s) => !RETRYABLE_FAILURES.includes(s))) throw new Error("Invalid retry policy");
      micros(horizon + Math.ceil(number(r.retry.backoff, "us") * 2 ** tries * 2));
    }
  }
  if (probes > caps.healthChecks) throw new Error("Health-check event budget exceeded");
  const spans = new Map<string, Array<[number, number]>>();
  for (const i of input.networkInterventions) {
    const at = number(i.at, "us");
    if (["partition", "bandwidth", "delay"].includes(i.kind) ? !links.has(i.target) : i.kind === "reset" ? !input.paths.some((p) => p.id === i.target) : !resourceIds.has(i.target)) throw new Error("Unknown intervention target");
    if (i.kind === "partition" || i.kind === "bandwidth" || i.kind === "delay" || i.kind === "service-state") {
      const end = micros(at + number(i.duration, "us", 1)), key = JSON.stringify([i.kind, i.target]), existing = spans.get(key) ?? [];
      if (existing.some(([a, b]) => at < b && end > a)) throw new Error("Overlapping network interventions unsupported"); existing.push([at, end]); spans.set(key, existing);
    }
    if (i.kind === "bandwidth") { const rate = number(i.bandwidth, "bytes/s", 0, false); if (!Number.isFinite(rate * horizon)) throw new Error("Bandwidth integral overflow"); }
    if (i.kind === "delay") micros(horizon + number(i.delay, "us"));
    if (i.kind === "service-state" && (typeof i.alive !== "boolean" || typeof i.ready !== "boolean")) throw new Error("Invalid endpoint state");
    if (i.kind === "service-state" && !i.alive && input.resources.find((r) => r.id === i.target)!.kind === "load-balancer") throw new Error("LB process suspension/restart is unmodeled; readiness gating is supported");
    if (i.kind === "drain") { const lb = input.resources.find((r) => r.id === i.target); if (lb?.kind !== "load-balancer" || !lb.backends.includes(i.backend)) throw new Error("Unknown draining backend"); micros(at + number(i.grace, "us")); }
  }
}
