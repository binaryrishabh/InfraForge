export function workloadObjectiveError(value: unknown): string | null {
  if (value === undefined) return null;
  const error = "Service objectives require version 1, an integer response target from 1 to 60000 ms and a finite success target from 50 to 99.99 percent.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return error;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["version", "maxResponseMs", "targetSuccessPercent"].includes(k)) || v.version !== 1 ||
    typeof v.maxResponseMs !== "number" || !Number.isInteger(v.maxResponseMs) || v.maxResponseMs < 1 || v.maxResponseMs > 60000 ||
    typeof v.targetSuccessPercent !== "number" || !Number.isFinite(v.targetSuccessPercent) || v.targetSuccessPercent < 50 || v.targetSuccessPercent > 99.99) return error;
  return null;
}
