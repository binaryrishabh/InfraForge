// apps/backend/infra/redis.ts
import Redis from "ioredis";
import { operationalWarning, redisPolicy } from "../utils/connectionPolicy";

// Only BullMQ consumers use unlimited retries. Producers and Pub/Sub must fail
// promptly so DB evidence and outbox retry handling can continue during outages.
export const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  ...redisPolicy(true),
});
export const commandRedis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  ...redisPolicy(),
});
redis.on("error", operationalWarning("Redis consumer unavailable; reconnecting."));
commandRedis.on("error", operationalWarning("Redis commands unavailable; reconnecting."));
