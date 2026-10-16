import { presentModel2 } from "@infraforge/simulation/internal-product";
import type { ProductEvidence } from "@infraforge/simulation/internal-product";
export function connectedPresentation(m: ProductEvidence) {
  const p = presentModel2(m);
  const observed = (key: string, value: number, path: string) => { p.values[key] = { kind: "Observed", value, unit: "count", atUs: m.at, provenance: [path, "Authored modeled fact; no physical/provider compatibility"] }; };
  for (const key of ["offered", "admitted", "completed", "rejected", "deadlineExceeded", "inFlight"] as const) observed(`caller.${key}`, m.counts[key], `counts.${key}`);
  for (const d of m.data.databases) {
    for (const key of ["committed", "aborted", "cancelled", "live"] as const) observed(`${d.id}.${key}`, d.transactions[key], `data.databases.${d.id}.transactions.${key}`);
    observed(`${d.id}.logicalReads`, d.logicalReads, `data.databases.${d.id}.logicalReads`); observed(`${d.id}.logicalWrites`, d.logicalWrites, `data.databases.${d.id}.logicalWrites`);
  }
  for (const lb of m.network.loadBalancers) for (const b of lb.backends) { observed(`${lb.id}.${b.id}.selected`, b.selected, `network.loadBalancers.${lb.id}.backends.${b.id}.selected`); p.values[`${lb.id}.${b.id}.eligible`] = { kind: "Observed", value: b.health && !b.draining, unit: "boolean", atUs: m.at, provenance: [`network.loadBalancers.${lb.id}.backends.${b.id}; observed health and draining, not process liveness`] }; }
  return p;
}
