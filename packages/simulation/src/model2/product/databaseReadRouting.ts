import type { Resource } from "@infraforge/domain/resource";
import type { ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const DATABASE_READ_ROUTING_PROFILE = "db-read-routing/1" as const;
export const changedDatabaseReadRouting = (r: Resource) => r.databaseReadRouting !== undefined;
export const databaseReadRoutingChanges = (resources: readonly Resource[]) => resources.some(changedDatabaseReadRouting);
export function validateDatabaseReadRoutingProfile(resources: readonly Resource[], contract: ProductContract) {
  const count = (version: string) => {
    const profiles = version.match(/\/db-read-routing\/[^/]+/g) ?? [];
    if (profiles.some(p => p !== `/${DATABASE_READ_ROUTING_PROFILE}`)) throw Error("Unsupported database read routing profile");
    return profiles.length;
  };
  if (count(contract.version) !== Number(databaseReadRoutingChanges(resources))) throw Error("Database read routing requires captured db-read-routing/1 and matching intent");
  for (const r of resources) if (count(contract.nodes[r.id]?.profileVersion ?? "") !== Number(changedDatabaseReadRouting(r))) throw Error("Database read routing requires its owned profile");
}
export function validateDatabaseReadRoutingBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const db of input.resources) if (db.kind === "relational" && db.readRouting !== undefined && !resources.some(r => r.id === db.id && r.databaseReadRouting !== undefined)) throw Error("Database read routing requires explicit owned intent");
  for (const r of resources) {
    const db = input.resources.find(d => d.id === r.id), expected = r.databaseReadRouting;
    if (expected !== undefined && (r.type !== "Database" || db?.kind !== "relational" || !db.replication || db.semantics !== "postgresql-keyed/2")) throw Error("Database read routing requires its owned HA engine");
    const actual = db?.kind === "relational" ? db.readRouting : undefined;
    if (expected === undefined ? actual !== undefined : !actual || actual.version !== expected.version || actual.policy !== expected.policy) throw Error("Database read routing must match saved intent");
  }
}
