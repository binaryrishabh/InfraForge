import type { Resource } from "@infraforge/domain/resource";
import { requireKnown } from "../../reality/quantity";
import type { SystemsInput } from "../systems/contracts";

export const DB_CONCURRENCY_PROFILE = "data-db-concurrency/1" as const;
export const changedDbConcurrency = (r: Resource) => r.type === "Database" && (r.dbConcurrency?.activeQueries !== undefined || r.dbConcurrency?.queuedQueries !== undefined);
export const dbConcurrencyChanges = (resources: readonly Resource[]) => resources.some(changedDbConcurrency);

export function validateDbConcurrencyBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources.filter(changedDbConcurrency)) {
    const db = input.resources.find(d => d.id === r.id), intent = r.dbConcurrency!;
    if (db?.kind !== "relational" || db.semantics !== "postgresql-keyed/2") throw Error("Database concurrency requires its owned PostgreSQL query engine");
    if ((intent.activeQueries !== undefined && requireKnown(db.activeTransactions, "count") !== intent.activeQueries) ||
        (intent.queuedQueries !== undefined && requireKnown(db.pendingQueries, "count") !== intent.queuedQueries)) throw Error("Database query budgets must match saved concurrency intent");
  }
}
