/** Optional saved workload intent, owned by its database. */
export interface DataKeyspace { version: 1; count: number }

// A learner working-set bound, below the engine's 100,000-key safety budget.
export const DATA_KEYSPACE_MAX = 1000;
export function dataKeyspaceError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Database") return "Data keyspace belongs to a Database.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Data keyspace requires version 1 and a bounded count.";
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["version", "count"].includes(k)) || v.version !== 1 || typeof v.count !== "number" || !Number.isSafeInteger(v.count) || v.count < 1 || v.count > DATA_KEYSPACE_MAX) return `Data keyspace requires version 1 and an integer count from 1 to ${DATA_KEYSPACE_MAX}.`;
}
