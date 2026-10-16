import { Queue } from "bullmq";
import { redis } from "../infra/redis";
import { INTERNAL_LIMITS } from "./budgets";
export const internalModel2Queue = new Queue("internal-model2", { connection: redis, defaultJobOptions: {
  attempts: INTERNAL_LIMITS.deliveries, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: { count: 100 }, removeOnFail: { count: 100 }
} });
