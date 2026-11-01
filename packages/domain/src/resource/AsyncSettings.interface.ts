import type { ResourceType } from "./RESOURCE_TYPES.constants";
export interface AsyncQueueSettings { enabled: boolean; visibilityTimeoutSeconds?: number; maxReceives?: number; retentionSeconds?: number; deadLetterCapacity?: number; capacityMessages?: number }
export interface AsyncWorkerSettings { enabled: boolean; concurrency?: number; prefetch?: number; cpuMsPerJob?: number; badJobPercent?: number; idempotentResults?: boolean }
export const DEFAULT_ASYNC_QUEUE_SETTINGS: AsyncQueueSettings = { enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300, deadLetterCapacity: 1000 };
export const DEFAULT_ASYNC_WORKER_SETTINGS: AsyncWorkerSettings = { enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 250, badJobPercent: 0 };
export function asyncSettingsError(type: ResourceType, queue?: AsyncQueueSettings, worker?: AsyncWorkerSettings): string | undefined {
  for (const [value, owner, fields] of [
    [queue, "Message Queue", { visibilityTimeoutSeconds: [1, 3600], maxReceives: [1, 10], retentionSeconds: [1, 86400], deadLetterCapacity: [0, 1000], capacityMessages: [1, 100000] }],
    [worker, "Virtual Machine", { concurrency: [1, 64], prefetch: [1, 64], cpuMsPerJob: [1, 120000], badJobPercent: [0, 100] }],
  ] as const) {
    if (value === undefined) continue;
    if (!value || type !== owner || typeof value.enabled !== "boolean" || Object.keys(value).some((k) => k !== "enabled" && !(value === worker && k === "idempotentResults") && !(k in fields))) return "Async settings need the matching queue or worker resource and recognized fields.";
    for (const [key, bounds] of Object.entries(fields)) {
      const n = (value as unknown as Record<string, unknown>)[key];
      if (n === undefined && (!value.enabled || key === "badJobPercent" || key === "deadLetterCapacity" || key === "capacityMessages")) continue;
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < bounds[0]! || n > bounds[1]!) return `Set ${key} between ${bounds[0]} and ${bounds[1]}.`;
    }
  }
  if (worker?.idempotentResults !== undefined && typeof worker.idempotentResults !== "boolean") return "Idempotent result writes must be Off or On.";
  if (worker?.enabled && worker.prefetch! < worker.concurrency!) return "Prefetch credit must cover jobs in parallel.";
}
