import type { createProductModel2 } from "./run";
export type ProductEvidence = ReturnType<ReturnType<typeof createProductModel2>["evidence"]>;
export type PresentationValue = { unit: string; provenance: string[]; atUs: number } & ({ kind: "Observed"; value: number | string | boolean } | { kind: "Interpreted"; value: number | string | boolean; rule: string } | { kind: "Unknown"; reason: string });
export function presentModel2(e: ProductEvidence) {
  const observed = (value: number | string | boolean, unit: string, path: string): PresentationValue => ({ kind: "Observed", value, unit, atUs: e.at, provenance: [path, `${e.product.versions.compiler}; model=2; internal evidence only`] });
  const unknown = (reason: string, unit: string, path: string): PresentationValue => ({ kind: "Unknown", reason, unit, atUs: e.at, provenance: [path] });
  const values: Record<string, PresentationValue> = { "cost.total": unknown("Provider/region/meter/price snapshot and billing dimensions not selected", "USD", "M2I provider contract required") };
  const processStates = new Map(e.product.controllers.flatMap((p) => p.replicas.map((r) => [r.id, r.state] as const)));
  for (const r of e.resources) {
    values[`${r.id}.queued`] = observed(r.queued, "count", `resources.${r.id}.queued`);
    values[`${r.id}.cpuConsumed`] = observed(r.consumedCoreUs, "cpu-us", `resources.${r.id}.consumedCoreUs`);
    const interval = e.intervals.filter((v) => v.resource === r.id).at(-1);
    values[`${r.id}.cpu`] = interval?.utilization.kind === "known" && typeof interval.utilization.total === "number" ? { kind: "Interpreted", value: interval.utilization.total * 100, unit: "percent", provenance: [`intervals.${r.id}.${interval.fromUs}-${interval.toUs}`], atUs: interval.toUs, rule: "100 × actual (app + competitor) consumed core-time / available core-time in this retained interval" } : unknown("No positive available-core-time interval", "percent", `intervals.${r.id}`);
    values[`${r.id}.memory`] = unknown("Complete resident process memory not identified", "bytes", `resources.${r.id}.compute.memory`);
    if (r.compute?.memory.totalResidentBytes.kind === "known") values[`${r.id}.memory`] = observed(r.compute.memory.totalResidentBytes.value, "bytes", `resources.${r.id}.compute.memory.totalResidentBytes; authored complete modeled ownership only`);
    if (processStates.has(r.id) && !["ready", "draining"].includes(processStates.get(r.id)!)) values[`${r.id}.cpu`] = unknown("Replica has no ready modeled process at this capture; dormant station capacity is not running infrastructure", "percent", `product.controllers.replicas.${r.id}.state`);
  }
  for (const q of e.asynchronous.brokers) { values[`${q.id}.ready`] = observed(q.ready, "count", `asynchronous.brokers.${q.id}.ready`); values[`${q.id}.inFlight`] = observed(q.inFlight, "count", `asynchronous.brokers.${q.id}.inFlight`); }
  for (const c of e.data.caches) for (const key of ["hits", "misses", "allocatedEntryBytes"] as const) values[`${c.id}.${key}`] = observed(c[key], key === "allocatedEntryBytes" ? "bytes" : "count", `data.caches.${c.id}.${key}`);
  for (const d of e.data.databases) values[`${d.id}.sessions`] = observed(d.sessions.total, "count", `data.databases.${d.id}.sessions.total`);
  for (const d of e.systems.resolvers) values[`${d.id}.cachedAnswers`] = observed(d.cache.length, "count", `systems.resolvers.${d.id}.cache`);
  for (const c of e.systems.cdns) for (const key of ["hits", "misses", "originRequests"] as const) values[`${c.id}.${key}`] = observed(c[key], "count", `systems.cdns.${c.id}.${key}`);
  for (const m of e.systems.monitors) for (const f of m.freshness) values[`${m.id}.${f.target}.freshness`] = f.ageUs === null ? unknown("No collected measurement", "us", `systems.monitors.${m.id}.freshness.${f.target}`) : observed(f.ageUs, "us", `systems.monitors.${m.id}.freshness.${f.target}.ageUs`);
  for (const p of e.product.controllers) { values[`${p.id}.desired`] = observed(p.desired, "count", `product.controllers.${p.id}.desired`); values[`${p.id}.inService`] = observed(p.inService, "count", `product.controllers.${p.id}.inService`); }
  return { schema: "infraforge-model2-presentation/1", model: "2", internal: true, versions: e.product.versions, values };
}
