export function clientRetryError(value: unknown): string | null {
  if (value === undefined) return null;
  const error = "Client retries require version 1, 2 to 4 total attempts and an integer backoff from 1 to 10000 ms; only application reads retry.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return error;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["version", "maxAttempts", "backoffMs"].includes(k)) || v.version !== 1 ||
    typeof v.maxAttempts !== "number" || !Number.isInteger(v.maxAttempts) || v.maxAttempts < 2 || v.maxAttempts > 4 ||
    typeof v.backoffMs !== "number" || !Number.isInteger(v.backoffMs) || v.backoffMs < 1 || v.backoffMs > 10000) return error;
  return null;
}
