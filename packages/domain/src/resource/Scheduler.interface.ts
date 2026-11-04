export interface SchedulerSettings {
  version: 1;
  startMs?: number;
  periodMs?: number;
  maxTriggers?: number;
  overlap?: "skip" | "allow" | "queue";
  maxConcurrent?: number;
  queueCapacity?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  maxLatenessMs?: number;
  missed?: "skip" | "latest";
  operation?: "read" | "write";
}
export const SCHEDULER_RANGES = { startMs: [0, 3600000], periodMs: [0, 3600000], maxTriggers: [1, 10000], maxConcurrent: [1, 128], queueCapacity: [0, 128], maxAttempts: [1, 10], retryDelayMs: [1, 60000], timeoutMs: [1, 60000], maxLatenessMs: [0, 3600000] } as const;
export const resolveScheduler = (s?: SchedulerSettings) => ({ startMs: s?.startMs ?? 0, periodMs: s?.periodMs ?? 1000, maxTriggers: s?.maxTriggers ?? 1000, overlap: s?.overlap ?? "skip", maxConcurrent: s?.maxConcurrent ?? 16, queueCapacity: s?.queueCapacity ?? 16, maxAttempts: s?.maxAttempts ?? 3, retryDelayMs: s?.retryDelayMs ?? 100, timeoutMs: s?.timeoutMs ?? 1000, maxLatenessMs: s?.maxLatenessMs ?? 60000, missed: s?.missed ?? "skip", operation: s?.operation ?? "write" });
export function schedulerError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Scheduler" || !value || typeof value !== "object" || Array.isArray(value)) return "Scheduler requires owned version 1 settings.";
  const s = value as Record<string, unknown>;
  if (s.version !== 1 || Object.keys(s).some(k => !["version", ...Object.keys(SCHEDULER_RANGES), "overlap", "missed", "operation"].includes(k))) return "Invalid Scheduler fields/version.";
  for (const [key, [min, max]] of Object.entries(SCHEDULER_RANGES)) if (s[key] !== undefined && (typeof s[key] !== "number" || !Number.isSafeInteger(s[key]) || s[key] < min || s[key] > max)) return `Invalid Scheduler ${key}.`;
  for (const [key, choices] of [["overlap", ["skip", "allow", "queue"]], ["missed", ["skip", "latest"]], ["operation", ["read", "write"]]] as const) if (s[key] !== undefined && !(choices as readonly unknown[]).includes(s[key])) return `Invalid Scheduler ${key}.`;
}
