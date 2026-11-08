/** Per source replica/path transport cap; independent of database session/query admission. */
export const DB_POOL_MAX_CONNECTIONS = 512; // Model 2 NETWORK_LIMITS.connectionsPerPool.
export function dbPoolError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Database") return "Application database connections belongs to a Database.";
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > DB_POOL_MAX_CONNECTIONS) return "Application database connections must be a whole number from 1 to 512.";
}
