import { Worker } from "bullmq";
import { z } from "zod";
import { redis } from "../infra/redis";
import type { WorkerOwnership } from "../infra/workerOwnership";
import { executeInternalRun } from "./execution";
export function internalWorker(ownership: WorkerOwnership) {
  const worker = new Worker("internal-model2", async (job) => {
    const data = z.object({ internalModel2RunId: z.uuid() }).strict().parse(job.data);
    await executeInternalRun(data.internalModel2RunId, ownership);
  }, { connection: redis, concurrency: 1, stalledInterval: 30000, maxStalledCount: 1 });
  worker.on("error", () => console.error("Internal Model-2 queue unavailable; readiness will refuse"));
  return worker;
}
