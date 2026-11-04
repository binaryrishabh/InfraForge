import { requireKnown } from "../../reality/quantity";
import type { AsyncInput } from "../async/contracts";
import type { SchedulerConfig } from "./contracts";
import { micros } from "../time";
export function validateScheduler(r: SchedulerConfig, input: AsyncInput) {
  const target = input.resources.find(t => t.id === r.target);
  if (r.profile !== "bounded-simulated-triggers/1" || target?.kind !== "compute" || !input.paths.some(p => p.source === r.id && p.target === r.target) || !["read", "write"].includes(r.operation) || !input.operations.some(o => o.id === r.operation) || !["skip", "allow", "queue"].includes(r.overlap) || !["skip", "latest"].includes(r.missed) || input.operations.some(o => o.entry === r.id)) throw Error("Invalid Scheduler target/profile/policy");
  for (const [q, unit, min, max] of [[r.start, "us", 0, 3600000000], [r.period, "us", 0, 3600000000], [r.maxTriggers, "count", 1, 10000], [r.maxConcurrent, "count", 1, 128], [r.queueCapacity, "count", 0, 128], [r.maxAttempts, "count", 1, 10], [r.retryDelay, "us", 1000, 60000000], [r.timeout, "us", 1000, 60000000], [r.maxLateness, "us", 0, 3600000000]] as const) {
    const v = requireKnown(q, unit);
    if (!Number.isSafeInteger(v) || v < min || v > max || !q.provenance.length || q.provenance.some(id => { const entry = input.ledger.find(e => e.id === id)?.quantity; return entry?.kind !== "known" || entry.unit !== unit || entry.value !== v; })) throw Error("Invalid Scheduler bounded quantity/provenance");
    if (unit === "us") micros(requireKnown(input.horizon, "us") + v);
  }
}
