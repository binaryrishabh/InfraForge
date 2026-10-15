import type { RealityEntry } from "../../reality/ledger";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { ControllerProfile } from "./contracts";
export function validateController(p: ControllerProfile, ledger: RealityEntry[]) {
  const count = (q: Quantity<"count">, min = 0) => { const n = requireKnown(q, "count"); if (!Number.isSafeInteger(n) || n < min) throw Error("Invalid controller population"); return n; };
  if (p.schema !== "generic-reconcile/1" || !p.version || !p.provenance.length || !p.loadBalancer || !p.artifact.reference) throw Error("Versioned authored generic controller and artifact reference required");
  const min = count(p.min, 1), max = count(p.max, min), initial = count(p.initial, min), slots = count(p.slots, max);
  if (initial > max || max > 128 || slots > 128 || requireKnown(p.target, "ratio") <= 0 || requireKnown(p.target, "ratio") > 1 || requireKnown(p.tolerance, "ratio") < 0 || requireKnown(p.tolerance, "ratio") >= 1 || count(p.attempts, 1) > 1000) throw Error("Invalid controller target/bounds");
  for (const [name, q] of Object.entries({ interval: p.interval, cooldown: p.cooldown, downStabilization: p.downStabilization, provision: p.provision, startup: p.startup, drain: p.drain, retry: p.retry })) { const n = requireKnown(q, "us"); if (!Number.isSafeInteger(n) || n < (["interval", "retry"].includes(name) ? 1 : 0)) throw Error("Invalid controller virtual time"); }
  if (Math.ceil(requireKnown(p.downStabilization, "us") / requireKnown(p.interval, "us")) + 1 > 10000) throw Error("Controller stabilization history budget exceeded");
  if (!["direct-core-time", "observed-core-time"].includes(p.signal.kind)) throw Error("Unknown metric source");
  if (p.signal.kind === "observed-core-time" && (!p.signal.backend || p.signal.stale !== "hold" || requireKnown(p.signal.freshFor, "us") <= 0)) throw Error("Observed source needs backend/age/explicit stale hold");
  if (p.provisionFailures.some((n) => !Number.isSafeInteger(n) || n < 0 || n >= slots) || new Set(p.provisionFailures).size !== p.provisionFailures.length) throw Error("Invalid authored provision failure ordinals");
  const manualIds = new Set<string>(), times = new Set<number>();
  for (const m of p.manual) { const time = requireKnown(m.at, "us"), n = count(m.desired, min); if (!Number.isSafeInteger(time) || time < 0 || n > max || manualIds.has(m.id) || times.has(time)) throw Error("Invalid/conflicting manual desired-capacity command"); manualIds.add(m.id); times.add(time); }
  const rows = new Map(ledger.map((e) => [e.id, e.quantity]));
  const inspect = (v: unknown) => { if (!v || typeof v !== "object") return; if ("kind" in v && "unit" in v && "provenance" in v) { const q = v as Quantity; const n = requireKnown(q, q.unit); if (q.provenance.some((id) => { const row = rows.get(id); return row?.kind !== "known" || row.unit !== q.unit || row.value !== n; })) throw Error("Controller quantity provenance missing"); } else Object.values(v).forEach(inspect); }; inspect(p);
}
export function recommendReplicas(ready: number, utilization: number, target: number, tolerance: number, min: number, max: number) {
  if (Math.abs(utilization / target - 1) <= tolerance) return Math.min(max, Math.max(min, ready));
  return Math.min(max, Math.max(min, Math.ceil(ready * utilization / target)));
}
