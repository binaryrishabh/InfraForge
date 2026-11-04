import { requireKnown } from "../../reality/quantity";
import type { AsyncInput } from "../async/contracts";
import type { ServerlessConfig } from "./contracts";
import { micros } from "../time";
export function validateServerless(r: ServerlessConfig, input: AsyncInput) {
  if (r.profile !== "invocation-warm-reuse/1" || (r.database && (input.resources.find(t => t.id === r.database)?.kind !== "relational" || !input.paths.some(p => p.source === r.id && p.target === r.database)))) throw Error("Invalid function profile/database path");
  for (const [q, unit, min, max] of [[r.concurrency, "count", 1, 128], [r.initialization, "us", 0, 60000000], [r.duration, "us", 1000, 60000000], [r.timeout, "us", 1000, 60000000], [r.idleExpiry, "us", 1000, 3600000000], [r.failurePercent, "percent", 0, 100]] as const) {
    const v = requireKnown(q, unit);
    if (!Number.isSafeInteger(v) || v < min || v > max || !q.provenance.length || q.provenance.some(id => { const entry = input.ledger.find(e => e.id === id)?.quantity; return entry?.kind !== "known" || entry.unit !== unit || entry.value !== v; })) throw Error("Invalid function bounded quantity/provenance");
    if (unit === "us") micros(requireKnown(input.horizon, "us") + v);
  }
  if (r.database) { const db = input.resources.find(t => t.id === r.database); if (db?.kind !== "relational" || input.operations.some(o => !db.plans[o.id])) throw Error("Function requires downstream database operation plans"); }
}
