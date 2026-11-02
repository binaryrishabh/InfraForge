export interface DatabaseReplication { version: 1; enabled: true; replicationDelayMs: number; readPolicy: "primary" | "replica-preferred" }
export const DATABASE_REPLICATION_DELAY_MAX_MS = 60000;
export function databaseReplicationError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Database") return "Database replication belongs to a Database.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Database replication requires version 1.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.enabled !== true || Object.keys(v).some(k => !["version", "enabled", "replicationDelayMs", "readPolicy"].includes(k))) return "Database replication requires version 1 and one enabled replica.";
  if (typeof v.replicationDelayMs !== "number" || !Number.isSafeInteger(v.replicationDelayMs) || v.replicationDelayMs < 1 || v.replicationDelayMs > DATABASE_REPLICATION_DELAY_MAX_MS) return "Modeled replication delay must be an integer from 1 to 60000 ms.";
  if (v.readPolicy !== "primary" && v.readPolicy !== "replica-preferred") return "Database read policy must be primary or replica-preferred.";
}
