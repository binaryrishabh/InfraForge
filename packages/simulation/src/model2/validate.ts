import { validateLedger } from "../reality/ledger";
import { requireKnown, type Quantity, type Unit } from "../reality/quantity";
import type { Model2Input } from "./contracts";
import { micros } from "./time";

export function validateModel2(input: Model2Input) {
  const errors = validateLedger(input.ledger);
  if (input.ledger.some((e) => e.modelVersion !== "2")) errors.push("Model-2 inputs cannot reuse historical Model-1 ledger semantics");
  if (input.modelVersion !== "2") errors.push("Explicit Model 2 required");
  if (!input.seed?.trim()) errors.push("Seed required");
  // Internal execution guards, not modeled infrastructure limits.
  if (input.resources.length > 256 || input.workload.length > 64) throw new Error("Internal topology/class budget exceeded");
  const ids = new Set<string>(), classes = new Set<string>();
  const ledger = new Map(input.ledger.map((e) => [e.id, e]));
  const number = <U extends Unit>(q: Quantity<U>, unit: U, min = 0, integer = true) => {
    let n = NaN;
    try { n = requireKnown(q, unit); } catch (e) { errors.push((e as Error).message); }
    if (!Number.isFinite(n) || n < min || (integer && !Number.isSafeInteger(n))) errors.push(`Invalid ${unit} limit/value`);
    for (const id of q.provenance) { const e = ledger.get(id);
      if (!e || e.quantity.unit !== unit || e.quantity.kind !== "known" || e.quantity.value !== n) errors.push(`Missing exact input provenance: ${id}`); }
    return n;
  };
  for (const key of ["maxEvents", "maxSamples", "maxRequests"] as const) {
    const n = input.limits[key]; if (!Number.isSafeInteger(n) || n <= 0) errors.push("Invalid execution budget");
  }
  const horizon = number(input.horizon, "us", 1), step = number(input.sampleInterval, "us", 1);
  if (Math.ceil(horizon / step) + 1 > input.limits.maxSamples) errors.push("Sample budget exceeded");
  let requests = 0;
  for (const c of input.workload) {
    if (!c.id || classes.has(c.id)) errors.push("Duplicate/empty request class"); classes.add(c.id);
    requests += number(c.count, "count"); number(c.interval, "us", 1); number(c.start, "us"); number(c.timeout, "us", 1);
  }
  if (requests > input.limits.maxRequests) errors.push("Request budget exceeded");
  for (const r of input.resources) {
    if (!r.id || ids.has(r.id)) errors.push("Duplicate/empty resource id"); ids.add(r.id);
    if (r.kind === "router") {
      if (!r.backends.length || new Set(r.backends).size !== r.backends.length) errors.push("Router needs unique backends");
    } else if (["compute", "database"].includes(r.kind)) {
      number(r.cores, "cores", Number.MIN_VALUE, false); number(r.concurrency, "count", 1); number(r.queueCapacity, "count");
      for (const c of classes) {
        const d = r.demand[c]; if (!d) { errors.push(`Missing ${r.id}/${c} service demand`); continue; }
        const cpu = number(d.cpu, "cpu-us"), io = number(d.io, "us");
        if (cpu + io <= 0) errors.push("Service demand must advance time");
        try { micros(Math.ceil(cpu / (r.cores.kind === "known" && r.concurrency.kind === "known" ? r.cores.value / r.concurrency.value : NaN)) + io); }
        catch { errors.push("Service duration overflow"); }
      }
    } else errors.push("Unsupported resource behavior");
  }
  const edges = new Map(input.resources.map((r) => [r.id, r.kind === "router" ? r.backends : r.downstream ? [r.downstream] : []]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (!ids.has(id)) { errors.push(`Unknown routing target: ${id}`); return; }
    if (visiting.has(id)) { errors.push("Cyclic synchronous dependency is unsupported"); return; }
    if (visited.has(id)) return;
    visiting.add(id); for (const to of edges.get(id)!) visit(to);
    visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
  for (const c of input.workload) { if (!ids.has(c.entry)) errors.push("Unknown workload entry");
    try { micros(c.start.kind === "known" && c.interval.kind === "known" && c.count.kind === "known" && c.timeout.kind === "known" ? c.start.value + c.interval.value * Math.max(0, c.count.value - 1) + c.timeout.value : NaN); } catch { errors.push("Arrival/deadline time overflow"); } }
  const faults = new Set<string>(), targetEnds = new Map<string, number>();
  for (const f of [...input.faults].sort((a, b) => (a.at.kind === "known" ? a.at.value : 0) - (b.at.kind === "known" ? b.at.value : 0))) {
    const target = input.resources.find((r) => r.id === f.target);
    if (!f.id || faults.has(f.id)) errors.push("Duplicate/empty fault id"); faults.add(f.id);
    if (!target || target.kind === "router" || f.kind !== "pause-service") errors.push("Unsupported fault capability");
    const at = number(f.at, "us"), duration = number(f.duration, "us", 1);
    if ((targetEnds.get(f.target) ?? -1) > at) errors.push("Overlapping faults unsupported");
    targetEnds.set(f.target, at + duration);
    try { micros(at + duration); } catch { errors.push("Fault time overflow"); }
  }
  if (errors.length) throw new Error(errors.join("; "));
}
