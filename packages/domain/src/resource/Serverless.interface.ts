export interface ServerlessSettings {
  version: 1;
  concurrency?: number;
  initializationMs?: number;
  durationMs?: number;
  timeoutMs?: number;
  idleExpiryMs?: number;
  failurePercent?: number;
}
export const SERVERLESS_RANGES = { concurrency: [1, 128], initializationMs: [0, 60000], durationMs: [1, 60000], timeoutMs: [1, 60000], idleExpiryMs: [1, 3600000], failurePercent: [0, 100] } as const;
export const resolveServerless = (s?: ServerlessSettings) => ({ concurrency: s?.concurrency ?? 16, initializationMs: s?.initializationMs ?? 100, durationMs: s?.durationMs ?? 10, timeoutMs: s?.timeoutMs ?? 1000, idleExpiryMs: s?.idleExpiryMs ?? 10000, failurePercent: s?.failurePercent ?? 0 });
export function serverlessError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Serverless Function" || !value || typeof value !== "object" || Array.isArray(value)) return "Serverless Function requires owned version 1 settings.";
  const s = value as Record<string, unknown>;
  if (s.version !== 1 || Object.keys(s).some(k => !["version", ...Object.keys(SERVERLESS_RANGES)].includes(k))) return "Invalid Serverless Function fields/version.";
  for (const [key, [min, max]] of Object.entries(SERVERLESS_RANGES)) if (s[key] !== undefined && (typeof s[key] !== "number" || !Number.isSafeInteger(s[key]) || s[key] < min || s[key] > max)) return `Invalid Serverless Function ${key}.`;
}
