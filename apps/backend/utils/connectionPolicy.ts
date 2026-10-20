import type { PoolConfig } from "pg";
import type { RedisOptions } from "ioredis";

// API/WS may use transaction pooling, which rejects arbitrary startup GUCs.
// Always bound the client pool; only verified worker sessions send server GUCs.
export const databasePoolPolicy: PoolConfig = {
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  query_timeout: 20000,
  keepAlive: true,
};
export function databasePoolOptions(workerMode?: string): PoolConfig {
  return {
    ...databasePoolPolicy,
    ...(workerMode === "direct" || workerMode === "session" ? {
      statement_timeout: 15000,
      idle_in_transaction_session_timeout: 30000,
    } : {}),
  };
}
export const databaseAdapterPolicy = { disposeExternalPool: true };

export function redisPolicy(consumer = false): RedisOptions {
  return {
    connectTimeout: 2000,
    maxRetriesPerRequest: consumer ? null : 1,
    enableOfflineQueue: consumer,
    // BullMQ blocking reads must outlive ordinary command deadlines.
    ...(consumer ? {} : { commandTimeout: 2000 }),
    retryStrategy: (attempt) => Math.min(100 * 2 ** Math.min(attempt, 5), 3000) + Math.floor(Math.random() * 250),
  };
}

export function outboxRetryDelay(failures: number, random = Math.random): number {
  const ceiling = Math.min(5000 * 2 ** Math.min(Math.max(0, failures - 1), 3), 30000);
  return Math.floor(ceiling * (0.8 + random() * 0.2));
}

// Fixed labels only. Never pass exception messages, URLs or request data here.
export function operationalWarning(label: string) {
  let last: number | undefined;
  return () => {
    if (last !== undefined && Date.now() - last < 30000) return;
    last = Date.now();
    console.error(label);
  };
}
