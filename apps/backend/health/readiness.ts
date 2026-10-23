import { Pool } from "pg";
import Redis from "ioredis";
import { checkHistory, checkSchemaGuards } from "../release/migrations";
import { releaseMetadata } from "../release/runtime";
import { createReadinessCache } from "./readinessCache";

export function createReadiness(extra: () => Promise<void> = async () => {}) {
  const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 2000, query_timeout: 2000 });
  db.on("error", () => {});
  const redis = new Redis({ host: process.env.REDIS_HOST || "localhost", port: Number(process.env.REDIS_PORT || 6379),
    lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, commandTimeout: 2000, connectTimeout: 2000 });
  redis.on("error", () => {});
  const check = async () => {
    try {
      await db.query("SELECT 1");
      if (redis.status === "wait") await redis.connect();
      if (await redis.ping() !== "PONG") throw new Error("Redis unavailable");
      if (process.env.NODE_ENV === "production") { await checkHistory(db); await checkSchemaGuards(db); }
      await extra();
      return { success: true, release: await releaseMetadata() };
    } catch { return { success: false }; }
  };
  const cache = createReadinessCache(check);
  db.on("error", () => cache.invalidate());
  redis.on("close", () => cache.invalidate());
  return { started: cache.started, check: cache.check,
    close: async () => { await cache.close(); redis.disconnect(); await db.end(); } };
}
