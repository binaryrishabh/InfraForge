import type { Resource } from "@infraforge/domain/resource";
import type { ProductContract } from "./contracts";

export const DATABASE_REJOIN_PROFILE = "db-rejoin/1" as const;
export const changedDatabaseRejoin = (r: Resource) => r.databaseReplication?.rejoin !== undefined;
export const databaseRejoinChanges = (resources: readonly Resource[]) => resources.some(changedDatabaseRejoin);
export function validateDatabaseRejoinProfile(resources: readonly Resource[], contract: ProductContract) {
  const count = (version: string) => {
    const profiles = version.match(/\/db-rejoin\/[^/]+/g) ?? [];
    if (profiles.some(p => p !== `/${DATABASE_REJOIN_PROFILE}`)) throw Error("Unsupported database rejoin profile");
    return profiles.length;
  };
  if (count(contract.version) !== Number(databaseRejoinChanges(resources))) throw Error("Database rejoin requires captured db-rejoin/1 and matching intent");
  for (const r of resources) if (count(contract.nodes[r.id]?.profileVersion ?? "") !== Number(changedDatabaseRejoin(r))) throw Error("Database rejoin requires its owned profile");
}
