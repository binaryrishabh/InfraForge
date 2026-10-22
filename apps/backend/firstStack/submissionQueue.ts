import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Pool } from "pg";
import { z } from "zod";
import { markSubmissionRecovery, verifySubmission, type SubmissionVerifier } from "./submissionWorker";
import { historicalReplayTarget, ownedReplayRow, replayHistoricalSubmission } from "./historicalReplay";
import { submissionTransaction, submissionEnvelope } from "./admission";
import { AppError, NotFoundError } from "../utils/errors";
import { randomUUID } from "node:crypto";

const name = "first-stack-verification";
// Explicit lifecycle factory, never started by import or by the Model-1 worker.
// Operator activation must supply trusted host config and the direct DB URL.
export async function startSubmissionQueue(pool: Pool, databaseUrl: string, producer: ConnectionOptions,
  consumer: ConnectionOptions, configuration: SubmissionVerifier, replayPolicy = { enabled: false }) {
  const queue = new Queue(name, { connection: producer, defaultJobOptions: { attempts: 1, removeOnComplete: false, removeOnFail: false } });
  await queue.setGlobalConcurrency(1);
  await markSubmissionRecovery(pool);
  const worker = new Worker(name, async job => {
    if (job.data.operation === "replay") {
      const request = z.object({ operation: z.literal("replay"), replayId: z.uuid() }).strict().parse(job.data);
      return replayHistoricalSubmission(pool, databaseUrl, request.replayId, configuration,
        () => replayPolicy.enabled, async () => stopped);
    }
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
    const replays = await pool.query('SELECT id FROM "FirstStackReplay" WHERE NOT delivered AND status=\'queued\' ORDER BY "createdAt",id LIMIT 16');
    for (const row of replays.rows) {
      if (stopped) break;
      await queue.add("replay", { operation: "replay", replayId: row.id }, { jobId: `replay-${row.id}` });
      await pool.query('UPDATE "FirstStackReplay" SET delivered=true WHERE id=$1 AND NOT delivered AND status<>\'terminal\'', [row.id]);
    }
  };
  const tick = () => {
    poll = deliver().catch(() => { console.error("First-stack outbox delivery deferred"); }).finally(() => {
      if (!stopped) timer = setTimeout(tick, 1000);
    });
  };
  await worker.waitUntilReady(); tick();
  const replay = {
    async availability(owner: string, runId: string) {
      const row = await ownedReplayRow(pool, owner, runId);
      try {
        if (!replayPolicy.enabled || stopped) throw Error("Historical replay disabled; report remains readable");
        historicalReplayTarget(row, configuration);
        return { replay: "available" as const, reasons: ["Qualified pinned executor can verify the retained server prefix; report reading does not execute."] };
      } catch (error) { return { replay: "unavailable" as const, reasons: [error instanceof Error ? error.message : "Historical replay unavailable"] }; }
    },
    async request(owner: string, runId: string) {
      if (!replayPolicy.enabled || stopped) throw new NotFoundError();
      const row = await ownedReplayRow(pool, owner, runId), cut = historicalReplayTarget(row, configuration);
      return submissionTransaction(pool, async db => {
        if ((await db.query('SELECT count(*)::int AS count FROM "FirstStackReplay"')).rows[0].count >= 1000) throw new AppError("Replay diagnostic storage busy", 503);
        const pending = (await db.query('SELECT count(*)::int AS count FROM "FirstStackWork" WHERE status<>\'terminal\'')).rows[0].count;
        const replays = (await db.query('SELECT "ownerId" FROM "FirstStackReplay" WHERE status<>\'terminal\'')).rows;
        if (pending + replays.length >= submissionEnvelope.queued || replays.some(j => j.ownerId === owner) ||
          (await db.query('SELECT 1 FROM "FirstStackWork" w JOIN "FirstStackRun" r ON r.id=w."runId" WHERE r."ownerId"=$1 AND w.status<>\'terminal\' LIMIT 1', [owner])).rowCount) throw new AppError("Execute/replay capacity busy", 503);
        const id = randomUUID();
        await db.query('INSERT INTO "FirstStackReplay" (id,"runId","ownerId",fingerprint) VALUES ($1,$2,$3,$4)', [id, runId, owner, cut.fingerprint]);
        return { id, status: "queued" as const, fingerprint: cut.fingerprint };
      });
    },
    async read(owner: string, runId: string, id: string) {
      await ownedReplayRow(pool, owner, runId);
      const row = (await pool.query('SELECT status,result FROM "FirstStackReplay" WHERE id=$1 AND "runId"=$2 AND "ownerId"=$3', [id, runId, owner])).rows[0];
      if (!row) throw new NotFoundError();
      return { id, status: row.status, result: row.result ?? (row.status === "recovery" ? { kind: "Unavailable", reason: "Replay worker interrupted; operator cleanup required, no continuation or automatic retry" } : null) };
    },
    async cancel(owner: string, runId: string, id: string) {
      await submissionTransaction(pool, async db => {
        const row = (await db.query('SELECT * FROM "FirstStackReplay" WHERE id=$1 AND "runId"=$2 AND "ownerId"=$3 FOR UPDATE', [id, runId, owner])).rows[0];
        if (!row) throw new NotFoundError();
        if (row.status === "terminal") return;
        if (row.status === "queued") await db.query('UPDATE "FirstStackReplay" SET cancelled=true,status=\'terminal\',result=$2 WHERE id=$1', [id, { kind: "Unavailable", reason: "Replay cancelled before executor ownership" }]);
        else await db.query('UPDATE "FirstStackReplay" SET cancelled=true WHERE id=$1', [id]);
      });
    },
  };
  return { queue, worker, replay, async close() { stopped = true; clearTimeout(timer); await poll; await worker.close(); await queue.close(); } };
}
