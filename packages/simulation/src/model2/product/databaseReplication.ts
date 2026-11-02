import type { Resource } from "@infraforge/domain/resource";
import type { ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const DATABASE_REPLICATION_PROFILE = "db-replication/1" as const;
export const changedDatabaseReplication = (r: Resource) => r.databaseReplication !== undefined;
export const databaseReplicationChanges = (resources: readonly Resource[]) => resources.some(changedDatabaseReplication);
export function validateDatabaseReplicationProfile(resources: readonly Resource[], contract: ProductContract) {
  const count = (version: string) => {
    const profiles = version.match(/\/db-replication\/[^/]+/g) ?? [];
    if (profiles.some(p => p !== `/${DATABASE_REPLICATION_PROFILE}`)) throw Error("Unsupported database replication profile");
    return profiles.length;
  };
  if (count(contract.version) !== Number(databaseReplicationChanges(resources))) throw Error("Database replication requires its captured db-replication/1 profile");
  for (const r of resources) if (count(contract.nodes[r.id]?.profileVersion ?? "") !== Number(changedDatabaseReplication(r))) throw Error("Database replication requires its owned profile and matching intent");
}
export function validateDatabaseReplicationBindings(resources: readonly Resource[], input: SystemsInput) {
  for (const r of resources) {
    const db = input.resources.find(d => d.id === r.id);
    if (r.databaseReplication !== undefined && (r.type !== "Database" || db?.kind !== "relational")) throw Error("Database replication requires its owned relational engine");
    const actual = db?.kind === "relational" ? db.replication : undefined, expected = r.databaseReplication;
    if (expected === undefined ? actual !== undefined : !actual || actual.version !== expected.version || actual.enabled !== true || actual.replicationDelayMs !== expected.replicationDelayMs || actual.readPolicy !== expected.readPolicy) throw Error("Database replication must match saved intent");
  }
}
