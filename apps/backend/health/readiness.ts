import { Pool } from "pg";
import Redis from "ioredis";
import { checkHistory, checkSchemaGuards } from "../release/migrations";
import { releaseMetadata } from "../release/runtime";
import { createReadinessCache } from "./readinessCache";

interface ProbeParts<R> {
  light: () => Promise<void>;
  deep: () => Promise<void>;
  extra: () => Promise<void>;
  release: () => Promise<R>;
}

// Schema and migration history only change through a release, which restarts every
// process. Deep verification (about 54 KB of catalog rows per run) therefore runs at
// startup and after a lost database session, not on every scheduled probe; running
// it every 10 seconds in each process exhausted a hosted database's transfer quota.
export function deepOnce<R>(parts: ProbeParts<R>) {
  let verified = false;
  const probe = async (): Promise<{ success: boolean; release?: R }> => {
    try {
      await parts.light();
      if (!verified) { await parts.deep(); verified = true; }
      await parts.extra();
      return { success: true, release: await parts.release() };
    } catch {
      verified = false;
      return { success: false };
    }
  };
  return Object.assign(probe, { reverify: () => { verified = false; } });
}

export function createReadiness(extra: () => Promise<void> = async () => {}) {
  const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 2000, query_timeout: 2000 });
  db.on("error", () => {});
  const redis = new Redis({ host: process.env.REDIS_HOST || "localhost", port: Number(process.env.REDIS_PORT || 6379),
    lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, commandTimeout: 2000, connectTimeout: 2000 });
  redis.on("error", () => {});
  const check = deepOnce({
    light: async () => {
      await db.query("SELECT 1");
      if (redis.status === "wait") await redis.connect();
      if (await redis.ping() !== "PONG") throw new Error("Redis unavailable");
    },
    deep: async () => {
      if (process.env.NODE_ENV === "production") { await checkHistory(db); await checkSchemaGuards(db); }
    },
    extra,
    release: releaseMetadata,
  });
  const cache = createReadinessCache(check);
  // A lost database session may reconnect to a changed database, so verify the schema again.
  db.on("error", () => { check.reverify(); cache.invalidate(); });
  redis.on("close", () => cache.invalidate());
  return { started: cache.started, check: cache.check,
    close: async () => { await cache.close(); redis.disconnect(); await db.end(); } };
}
