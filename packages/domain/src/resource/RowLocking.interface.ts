/** Optional saved order in which a write touches two rows, owned by its Database. Educational model of acquisition order only. */
export interface RowLocking { version: 1; rowsPerWrite: 2; order: "as-requested" | "by-key" }
export const ROW_LOCK_ORDERS = ["as-requested", "by-key"] as const;

export function rowLockingError(type: string, value: unknown, keyspace?: { count?: number }): string | undefined {
  if (value === undefined) return;
  if (type !== "Database") return "Row locking belongs to a Database.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Row locking requires version 1, two rows per write and an order.";
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["version", "rowsPerWrite", "order"].includes(k)) || v.version !== 1 || v.rowsPerWrite !== 2 || (v.order !== "as-requested" && v.order !== "by-key")) return "Row locking requires version 1, two rows per write and an order of as-requested or by-key.";
  if (!keyspace || typeof keyspace.count !== "number" || keyspace.count < 2) return "Row locking needs a saved data keyspace of at least two rows.";
}
