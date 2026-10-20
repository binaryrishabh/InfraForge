import { Queue } from "bullmq";
import { commandRedis } from "./redis";
import { operationalWarning } from "../utils/connectionPolicy";

export const deploymentQueue = new Queue("deployments", {
  connection: commandRedis,
  defaultJobOptions: {
    attempts: 10,
    backoff: {
      type: "exponential",
      delay: 10000,
      jitter: 0.2,
    },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 604800, count: 5000 },
  }
});
deploymentQueue.on("error", operationalWarning("Deployment queue unavailable; delivery will retry."));
