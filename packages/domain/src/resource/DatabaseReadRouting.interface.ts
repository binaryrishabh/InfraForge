import type { DatabaseReplication } from "./DatabaseReplication.interface";

export interface DatabaseReadRouting { version: 1; policy: "primary-only" | "replica-preferred" }
export function databaseReadRoutingError(type: string, value: unknown, replication?: DatabaseReplication): string | undefined {
  if (value === undefined) return;
  if (type !== "Database" || !replication?.enabled) return "Database read routing requires a Database with one enabled replica.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Database read routing requires version 1.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || Object.keys(v).some(k => !["version", "policy"].includes(k)) || !["primary-only", "replica-preferred"].includes(v.policy as string)) return "Database read routing requires version 1 and primary-only or replica-preferred.";
}
