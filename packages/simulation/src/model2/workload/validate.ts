import { validateLedger } from "../../reality/ledger";
import { requireKnown, type Quantity, type Unit } from "../../reality/quantity";
import { micros } from "../time";
import { ingestTrace, rateRows, validateRate } from "./arrivals";
import { resolveDemand, validateProfile, type ProfileContext } from "./profiles";
import type { WorkloadInput } from "./contracts";
import { WORKLOAD_LIMITS as caps } from "./policy";

export function validateWorkload(input: WorkloadInput) {
  const errors = validateLedger(input.ledger);
  const ledger = new Map(input.ledger.map((e) => [e.id, e]));
  if (input.modelVersion !== "2" || input.workloadVersion !== "m2b/1" || !input.seed?.trim() || input.ledger.some((e) => e.modelVersion !== "2" || !e.validityDomain?.trim())) errors.push("Explicit internal M2B version/seed/ledger validity domain required");
  for (const [key, n] of Object.entries(input.limits)) if (!Number.isSafeInteger(n) || n < (key === "maxRawResults" ? 0 : 1)) errors.push(`Invalid budget: ${key}`);
  if (input.resources.length > caps.resources || input.operations.length > caps.operations || input.arrivals.length > caps.sources || input.profiles.length > caps.profiles || input.faults.length > caps.faults || input.limits.maxSamples > caps.samples || input.limits.maxEvents > caps.events || input.limits.maxRequests > caps.requests || input.limits.maxTraceRows > caps.traceRows || input.limits.maxRawResults > input.limits.maxRequests) errors.push("Internal structural/memory budget exceeded");
  const exact = (q: Quantity) => {
    for (const id of q.provenance) {
      const e = ledger.get(id)?.quantity;
      if (!e || e.unit !== q.unit || e.kind !== q.kind || (e.kind === "known" && q.kind === "known" && e.value !== q.value) || (e.kind === "range" && q.kind === "range" && (e.min !== q.min || e.max !== q.max))) errors.push(`Missing exact input provenance: ${id}`);
    }
  };
  const number = <U extends Unit>(q: Quantity<U>, unit: U, min = 0, integer = true) => {
    const n = requireKnown(q, unit); exact(q);
    if (n < min || (integer && !Number.isSafeInteger(n))) errors.push(`Invalid ${unit} quantity`);
    return n;
  };
  const unique = (ids: string[], kind: string) => {
    if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !id || id.length > caps.identityCharacters)) errors.push(`Duplicate/invalid ${kind} identity`);
  };
  unique(input.resources.map((r) => r.id), "resource"); unique(input.operations.map((r) => r.id), "operation");
  unique(input.arrivals.map((r) => r.id), "arrival source"); unique(input.profiles.map((p) => p.id), "profile"); unique(input.faults.map((f) => f.id), "fault");
  const operations = new Map(input.operations.map((o) => [o.id, o])), resources = new Map(input.resources.map((r) => [r.id, r]));
  const profiles = new Map(input.profiles.map((p) => [p.id, p]));
  const horizon = number(input.horizon, "us", 1), step = number(input.sampleInterval, "us", 1);
  if (Math.ceil(horizon / step) + 1 > input.limits.maxSamples) errors.push("Sample budget exceeded");
  for (const p of input.profiles) {
    errors.push(...validateProfile(p)); exact(p.cpu); exact(p.io);
    for (const range of Object.values(p.validity.ranges)) exact({ kind: "range", ...range });
  }
  const demands = new Map<string, Map<string, { cpuUs: number; ioUs: number }>>();
  for (const r of input.resources) {
    if (r.kind === "router") {
      if (!r.backends.length || new Set(r.backends).size !== r.backends.length) errors.push("Router requires unique backends"); continue;
    }
    if (!["compute", "database"].includes(r.kind) || !["cooperative", "unsupported"].includes(r.cancellation)) errors.push("Invalid station/cancellation capability");
    const cores = number(r.cores, "cores", Number.MIN_VALUE, false), slots = number(r.concurrency, "count", 1); number(r.queueCapacity, "count");
    for (const q of Object.values(r.context.quantities)) { requireKnown(q, q.unit); exact(q); }
    // Worker count is a physical station property, not a caller-supplied applicability claim.
    const context: ProfileContext = { labels: r.context.labels, quantities: { ...r.context.quantities, workers: r.concurrency, cores: r.cores } };
    const resolved = new Map<string, { cpuUs: number; ioUs: number }>();
    for (const op of input.operations) {
      const p = profiles.get(r.profiles[op.id]!);
      if (!p) { errors.push(`Missing profile binding: ${r.id}/${op.id}`); continue; }
      if (p.validity.ranges.arrivalIntervalUs) {
        const a = input.arrivals.length === 1 ? input.arrivals[0] : undefined;
        const interval = a?.kind === "periodic" ? requireKnown(a.interval, "us") : a?.kind === "trace" && a.trace.rows.length > 1 ? a.trace.rows[1]!.atUs - a.trace.rows[0]!.atUs : NaN;
        const claimed = context.quantities.arrivalIntervalUs;
        if (!claimed || claimed.kind !== "known" || claimed.unit !== "us" || claimed.value !== interval || interval <= 0 || (a?.kind === "trace" && a.trace.rows.some((row, i) => i > 0 && row.atUs - a.trace.rows[i - 1]!.atUs !== interval))) errors.push("Unknown/outside periodic arrival-interval applicability");
      }
      const d = resolveDemand(p, op.id, r.kind, context);
      if (d.kind === "unknown") { errors.push(`Unknown demand ${r.id}/${op.id}: ${d.reason}`); continue; }
      exact(p.cpu); exact(p.io);
      if (d.cpuUs + d.ioUs <= 0) errors.push("Service must advance virtual time");
      micros(horizon + Math.ceil(d.cpuUs / (cores / slots)) + d.ioUs); resolved.set(op.id, d);
    }
    demands.set(r.id, resolved);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) { errors.push("Cyclic synchronous dependency unsupported"); return; }
    if (visited.has(id)) return;
    const r = resources.get(id); if (!r) { errors.push(`Unknown target: ${id}`); return; }
    visiting.add(id);
    for (const target of r.kind === "router" ? r.backends : r.downstream ? [r.downstream] : []) visit(target);
    visiting.delete(id); visited.add(id);
  };
  for (const r of input.resources) visit(r.id);
  for (const o of input.operations) {
    if (!resources.has(o.entry) || !["detach", "request-cancellation"].includes(o.onCallerStop) || !["read-only", "idempotent", "non-idempotent", "unknown"].includes(o.idempotency)) errors.push("Invalid operation ownership/entry");
    micros(horizon + number(o.callerTimeout, "us", 1));
    if (o.abandonAfter) micros(horizon + number(o.abandonAfter, "us", 1));
  }
  let count = 0;
  for (const a of input.arrivals) {
    if (a.kind === "trace") {
      const trace = ingestTrace(a.trace, a.trace.rows, input.limits.maxTraceRows, new Set(operations.keys()));
      count += trace.rows.length;
      for (const row of trace.rows) if (row.payloadBytes !== undefined) {
        // Payload metadata may not silently escape a profile's payload validity constraint.
        for (const r of input.resources) if (r.kind !== "router") {
          const bound = profiles.get(r.profiles[row.operation]!)?.validity.ranges.payloadBytes;
          if (!bound || bound.unit !== "bytes" || row.payloadBytes < bound.min || row.payloadBytes > bound.max) errors.push("Trace payload outside explicit profile domain");
        }
      }
    } else if (a.kind === "rate") {
      const invalid = validateRate(a.rate, new Set(operations.keys()));
      errors.push(...invalid);
      // Counted without storing rows; stops one past the budget.
      if (!invalid.length) for (const _row of rateRows(a.rate)) if (++count > input.limits.maxRequests) break;
    } else {
      if (!operations.has(a.operation)) errors.push("Unknown arrival operation");
      const start = number(a.start, "us");
      if (a.kind === "closed") {
        count += number(a.users, "count", 1) * number(a.perUser, "count", 1); number(a.think, "us");
      } else if (a.kind === "periodic" || a.kind === "poisson") {
        const n = number(a.count, "count"); count += n;
        const gap = number(a.kind === "periodic" ? a.interval : a.meanInterval, "us", 1);
        if (a.kind === "periodic") micros(start + Math.max(0, n - 1) * gap);
      } else errors.push("Unsupported arrival model");
    }
  }
  if (!Number.isSafeInteger(count) || count > input.limits.maxRequests) errors.push("Request budget exceeded");
  const ends = new Map<string, number>();
  for (const f of [...input.faults].sort((a, b) => requireKnown(a.at, "us") - requireKnown(b.at, "us"))) {
    const at = number(f.at, "us"), duration = number(f.duration, "us", 1);
    if (!resources.has(f.target) || resources.get(f.target)?.kind === "router" || f.kind !== "pause-service" || at < (ends.get(f.target) ?? -1)) errors.push("Unsupported/overlapping fault");
    micros(at + duration); ends.set(f.target, at + duration);
  }
  if (errors.length) throw new Error(errors.join("; "));
  return demands;
}
