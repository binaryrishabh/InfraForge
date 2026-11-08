// Saved challenge intent, consumed only by an explicitly opted-in scenario.
// It does not change a database's simulation configuration or enable live actions.
export interface DatabaseRecoveryPlan { version: 1; promoteAtSecond: number | null }
export function databaseRecoveryPlanError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Database" || !value || typeof value !== "object" || Array.isArray(value)) return "A recovery plan belongs to a database.";
  const plan = value as Record<string, unknown>;
  if (Object.keys(plan).sort().join() !== "promoteAtSecond,version" || plan.version !== 1 ||
    plan.promoteAtSecond !== null && (!Number.isSafeInteger(plan.promoteAtSecond) || Number(plan.promoteAtSecond) < 1 || Number(plan.promoteAtSecond) > 3599)) {
    return "Choose no promotion or a whole simulated second from 1 to 3599.";
  }
}
