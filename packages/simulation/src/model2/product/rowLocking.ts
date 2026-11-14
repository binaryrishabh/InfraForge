import type { Resource } from "@infraforge/domain/resource";
import type { Statement } from "../data/contracts";
import type { SystemsInput } from "../systems/contracts";

export const ROW_LOCK_ORDER_PROFILE = "row-lock-order/1" as const;
/** Marked means the saved order is present with either value, so a one-change pair shares one adapter selection. */
export const changedRowLocking = (r: Resource) => r.type === "Database" && r.rowLocking !== undefined;
export const rowLockingChanges = (resources: readonly Resource[]) => resources.some(changedRowLocking);
/** Unmarked databases keep their previous bytes: no field at all. */
export const rowLockingField = (r: Resource) => r.rowLocking === undefined ? {} : { rowLocking: { order: r.rowLocking.order } };

/** A marked write is the unmarked one-row write (2 ms of database CPU) plus a second 1 ms row update, both authored assumptions; reads and unmarked writes keep one statement. */
export function rowLockingStatements(r: Resource, op: string, one: (tag: string, key: string, cpuUs: number) => Statement): Statement[] | undefined {
  return r.rowLocking !== undefined && op === "write" ? [one("", "$key", 2000), one(".row2", "$key2", 1000)] : undefined;
}

export const ROW_LOCKING_NOTE = "Educational model of the order in which a write touches two rows and holds their exclusive locks until commit. No claim about any specific database product's lock manager, deadlock timeout or victim choice: the model detects a cycle immediately and ends the requesting transaction.";

/** Refused rather than guessed: the second row has no meaning behind a replica, a read router, a cache or a typed application flow. */
export function rowLockingRefusal(database: Resource, incoming: readonly Resource[], outgoingOf: (id: string) => readonly Resource[]): string | undefined {
  if (!changedRowLocking(database)) return;
  if (database.databaseReplication !== undefined || database.databaseReadRouting !== undefined) return "A saved row lock order needs a database without replication or read routing.";
  if (incoming.some(app => app.type === "Cache" || app.applicationFlow !== undefined || outgoingOf(app.id).some(t => t.type === "Cache"))) return "A saved row lock order models plain app-to-database writes; a cache in front of the database or a typed application flow is not supported.";
}

export function validateRowLockingBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const db of input.resources.filter(d => d.kind === "relational")) {
    const saved = resources.find(r => r.id === db.id)?.rowLocking;
    if (saved === undefined ? db.rowLocking !== undefined : db.rowLocking?.order !== saved.order) throw Error("Row lock order must match saved intent");
  }
}
