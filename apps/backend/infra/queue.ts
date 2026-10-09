import { Queue } from "bullmq";
import { redis } from "./redis";

export const deploymentQueue = new Queue("deployments", {
  connection: redis,
  defaultJobOptions: {
    attempts: 10,
    backoff: {
      type: "exponential",
      delay: 10000
    }
  }
});