import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Pool } from "pg";
import { z } from "zod";
import { markSubmissionRecovery, verifySubmission, type SubmissionVerifier } from "./submissionWorker";

const name = "first-stack-verification";
// Explicit lifecycle factory, never started by import or by the Model-1 worker.
// Operator activation must supply trusted host config and the direct DB URL.
export async function startSubmissionQueue(pool: Pool, databaseUrl: string, producer: ConnectionOptions,
  consumer: ConnectionOptions, configuration: SubmissionVerifier) {
  const queue = new Queue(name, { connection: producer, defaultJobOptions: { attempts: 1, removeOnComplete: false, removeOnFail: false } });
  await queue.setGlobalConcurrency(1);
  await markSubmissionRecovery(pool);
  const worker = new Worker(name, async job => {
    const { runId } = z.object({ runId: z.uuid() }).strict().parse(job.data);
    await verifySubmission(pool, databaseUrl, runId, configuration);
  }, { connection: consumer, concurrency: 1, maxStalledCount: 0 });
  worker.on("error", () => console.error("First-stack verification queue unavailable"));
  queue.on("error", () => console.error("First-stack submission delivery unavailable"));
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, poll: Promise<void> | undefined;
  const deliver = async () => {
    const rows = await pool.query('SELECT "runId" FROM "FirstStackOutbox" WHERE NOT delivered ORDER BY "createdAt","runId" LIMIT 16');
    for (const row of rows.rows) {
      if (stopped) break;
      // Stable IDs plus the DB claim make lost Redis/DB responses safe. Only
      // delivery is retried; uncertain execution is never re-enqueued as work.
      await queue.add("verify", { runId: row.runId }, { jobId: row.runId });
      await pool.query('UPDATE "FirstStackOutbox" SET delivered=true WHERE "runId"=$1', [row.runId]);
    }
  };
  const tick = () => {
    poll = deliver().catch(() => { console.error("First-stack outbox delivery deferred"); }).finally(() => {
      if (!stopped) timer = setTimeout(tick, 1000);
    });
  };
  await worker.waitUntilReady(); tick();
  return { queue, worker, async close() { stopped = true; clearTimeout(timer); await poll; await worker.close(); await queue.close(); } };
}
