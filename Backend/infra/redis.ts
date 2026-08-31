// Backend/infra/redis.ts
import Redis from "ioredis";

export const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: null // BullMQ needs this. Without it, BullMQ throws errors on retry.
});