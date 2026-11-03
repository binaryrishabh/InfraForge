export interface EventSubscription {
  id: string;
  edge: string;
  filter?: { keyPrefix: string };
}
export interface EventBusSettings {
  version: 1;
  capacityMessages?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  deliveryTimeoutMs?: number;
  deadLetterCapacity?: number;
  subscriptions?: EventSubscription[];
}
const defaults = { capacityMessages: 1000, maxAttempts: 3, retryDelayMs: 100, deliveryTimeoutMs: 1000, deadLetterCapacity: 100 } as const;
export const resolveEventBus = (settings?: EventBusSettings) => Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, settings?.[key as keyof typeof defaults] ?? value])) as { [K in keyof typeof defaults]: number };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
export function eventBusError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Event Bus" || !object(value) || value.version !== 1 || Object.keys(value).some(k => !["version", ...Object.keys(defaults), "subscriptions"].includes(k))) return "Event Bus requires owned version 1 settings.";
  const ranges = { capacityMessages: [1, 10000], maxAttempts: [1, 10], retryDelayMs: [1, 60000], deliveryTimeoutMs: [1, 60000], deadLetterCapacity: [0, 10000] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = value[key]; if (n !== undefined && (typeof n !== "number" || !Number.isSafeInteger(n) || n < min! || n > max!)) return `Invalid event bus ${key}.`;
  }
  if (value.subscriptions !== undefined) {
    const rows = value.subscriptions;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 16) return "Event Bus supports 1 to 16 subscriptions.";
    const ids = new Set(), edges = new Set();
    for (const row of rows) {
      if (!object(row) || !id(row.id) || !id(row.edge) || ids.has(row.id) || edges.has(row.edge) || Object.keys(row).some(k => !["id", "edge", "filter"].includes(k))) return "Unique subscription identities and edges required.";
      ids.add(row.id); edges.add(row.edge);
      if (row.filter !== undefined && (!object(row.filter) || Object.keys(row.filter).length !== 1 || typeof row.filter.keyPrefix !== "string" || row.filter.keyPrefix.length < 1 || row.filter.keyPrefix.length > 128)) return "A filter is one bounded key prefix.";
    }
  }
}
