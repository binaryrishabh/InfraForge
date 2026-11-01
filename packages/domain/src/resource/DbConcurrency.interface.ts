/** Optional execution admission limits owned by a Database resource. */
export interface DbConcurrency { version: 1; activeQueries?: number; queuedQueries?: number }
export const DB_ACTIVE_QUERIES_MAX = 512;
export const DB_QUEUED_QUERIES_MAX = 1000;

export function dbConcurrencyError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Database") return "Database concurrency belongs to a Database.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Database concurrency requires an explicit version.";
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return "Database concurrency requires version 1.";
  if (Object.keys(v).some(k => !["version", "activeQueries", "queuedQueries"].includes(k))) return "Database concurrency contains unsupported settings.";
  for (const [field, min, max] of [["activeQueries", 1, DB_ACTIVE_QUERIES_MAX], ["queuedQueries", 0, DB_QUEUED_QUERIES_MAX]] as const) {
    const n = v[field];
    if (n !== undefined && (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max)) return `${field} must be an integer from ${min} to ${max}.`;
  }
}
