import type { Resource } from "@infraforge/domain/resource";
import { requireKnown } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";
export const DB_POOL_PROFILE = "data-db-pool/1" as const;
export const dbPoolChanges = (resources: readonly Resource[]) => resources.some(r => r.dbPoolMaxConnections !== undefined);
export function validateDbPoolBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(r => r.dbPoolMaxConnections !== undefined)) {
    const paths = input.paths.filter(p => p.target === r.id);
    if (!paths.length || input.resources.find(d => d.id === r.id)?.kind !== "relational") throw Error("Application database connections requires a database transport path");
    for (const p of paths) if (p.pool.mode !== "serial" || p.pool.evidenceProfile !== "postgresql-pools/2" || requireKnown(p.pool.maxConnections, "count") !== r.dbPoolMaxConnections) throw Error("Database transport pool must match saved application connection maximum");
  }
}
