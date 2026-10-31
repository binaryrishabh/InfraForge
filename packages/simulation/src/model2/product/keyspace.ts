import { dataKeyspaceError, type Resource } from "@infraforge/domain/resource";
import type { AsideConfig, RelationalConfig } from "../data/contracts";
import type { Quantity } from "../../reality/quantity";
import type { NodeContract } from "./contracts";

export const KEYSPACE_PROFILE = "data-keyspace/1" as const;
export const HOT_KEY_PROFILE = "data-hot-key/1" as const;
export const multiKey = (resources: readonly Resource[]) => resources.some(r => (r.dataKeyspace?.count ?? 1) > 1);
export const hotKey = (resources: readonly Resource[]) => resources.some(r => (r.dataKeyspace?.count ?? 1) > 1 && r.dataKeyspace?.accessPattern === "hot-key");
const access = (database: Resource) => database.dataKeyspace?.accessPattern === "hot-key" ? "keyed-hot" as const : "keyed-uniform" as const;

/** Stable identities; explicit one must retain the historical literal key. */
export function dataKeys(resource: Resource): string[] {
  const error = dataKeyspaceError(resource.type, resource.dataKeyspace);
  if (error) throw Error(error);
  const count = resource.dataKeyspace?.count ?? 1;
  return count === 1 ? ["key"] : Array.from({ length: count }, (_, i) => `key-${i + 1}`);
}
export function asideKeyspace(database: Resource): Pick<AsideConfig, "keys" | "access"> {
  const keys = dataKeys(database);
  return { keys, access: keys.length === 1 ? "cycle" : access(database) };
}
export function databaseKeyspace(database: Resource, bytes: Quantity<"bytes">): Pick<RelationalConfig, "keys" | "initial" | "access"> {
  const keys = dataKeys(database);
  return { keys, initial: keys.map(key => ({ key, version: 1, bytes })), ...(keys.length > 1 ? { access: access(database) } : {}) };
}

export function validateDatabaseKeyspace(database: Resource, node: NodeContract) {
  if ((database.dataKeyspace?.count ?? 1) === 1) return;
  const keys = dataKeys(database), config = node.resources.find(r => r.role === node.primary)?.config;
  if (config?.kind !== "relational" || config.access !== access(database) || JSON.stringify(config.keys) !== JSON.stringify(keys) || JSON.stringify(config.initial.map(r => r.key)) !== JSON.stringify(keys) || config.initial.some(r => r.version !== 1) || Object.values(config.plans).some(p => p.statements.some(s => s.keys.length !== 1 || s.keys[0] !== "$key"))) throw Error("Database profile must model its saved keyspace and access pattern with initial rows and selected-key plans");
}
