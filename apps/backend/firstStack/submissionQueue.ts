import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Pool } from "pg";
import { z } from "zod";
import { markSubmissionRecovery, verifySubmission, type SubmissionVerifier } from "./submissionWorker";
import { historicalReplayTarget, ownedReplayRow, replayHistoricalSubmission } from "./historicalReplay";
import { submissionTransaction, submissionEnvelope } from "./admission";
import { AppError, NotFoundError } from "../utils/errors";
import { randomUUID } from "node:crypto";
import { requireCapability } from "../capabilities/policy";
import { acquireVerifierOwnership } from "./verifierOwnership";
import { verifierExecutionAllowed } from "./submissionWorker";
import { boundedVerifierDrain, drainVerifierWorker } from "./verifierDrain";
import { checkHistory, checkSchemaGuards } from "../release/migrations";
import { verificationJobOptions, reconcileSubmissionQueue, recordQueueEvent, queueOperations, pruneVerificationJobs } from "./queueOperations";
import { submissionStorage, requireSubmissionStorage } from "./submissionStorage";

const name = "first-stack-verification";
// Explicit lifecycle factory, never started by import or by the Model-1 worker.
// Operator activation must supply trusted host config and the direct DB URL.
export async function startSubmissionQueue(pool: Pool, databaseUrl: string, producer: ConnectionOptions,
  consumer: ConnectionOptions, configuration: SubmissionVerifier, replayPolicy = { enabled: false },
  invalidate: () => void = () => {}, prefix = "bull") {
  let stopped = false, lost = false, lastDelivery = 0;
  let timer: ReturnType<typeof setTimeout> | undefined, poll: Promise<void> | undefined;
  let loop: Promise<void> | undefined;
  const fail = () => { lastDelivery = 0; invalidate(); };
  const ownership = await acquireVerifierOwnership(databaseUrl, () => { lost = true; fail(); });
  const previousHealthy = configuration.healthy;
  configuration.healthy = () => !lost && ownership.held && previousHealthy?.() === true;
  const queue = new Queue(name, { prefix, connection: producer,
    defaultJobOptions: verificationJobOptions });
  const worker = new Worker(name, async job => {
    await ownership.assertHeld();
    if (job.data.operation === "replay") {
      const request = z.object({ operation: z.literal("replay"), replayId: z.uuid() }).strict().parse(job.data);
      return replayHistoricalSubmission(pool, databaseUrl, request.replayId, configuration,
        () => replayPolicy.enabled && verifierExecutionAllowed(configuration),
        async () => !verifierExecutionAllowed(configuration));
    }
    const { runId } = z.object({ runId: z.uuid() }).strict().parse(job.data);
    await verifySubmission(pool, databaseUrl, runId, configuration);
  }, { prefix, connection: consumer, concurrency: 1, maxStalledCount: 0, autorun: false });
  worker.on("error", fail); queue.on("error", fail); pool.on("error", fail);
  // Payloads and BullMQ failure messages never enter the operator read model.
  worker.on("failed", () => { void recordQueueEvent(pool, "failed").catch(fail); });
  worker.on("stalled", () => { void recordQueueEvent(pool, "stalled").catch(fail); });
  let lastPrune = 0;
  const deliver = async () => {
    await ownership.assertHeld();
    const rows = await pool.query('SELECT "runId" FROM "FirstStackOutbox" WHERE NOT delivered ORDER BY "createdAt","runId" LIMIT 16');
    for (const row of rows.rows) {
      if (stopped) break;
      // Stable IDs plus the DB claim make lost Redis/DB responses safe. Only
      // delivery is retried; uncertain execution is never re-enqueued as work.
      await queue.add("verify", { runId: row.runId }, { jobId: row.runId });
      await pool.query('UPDATE "FirstStackOutbox" SET delivered=true,"deliveredAt"=CURRENT_TIMESTAMP WHERE "runId"=$1', [row.runId]);
    }
    const replays = await pool.query('SELECT id FROM "FirstStackReplay" WHERE NOT delivered AND status=\'queued\' ORDER BY "createdAt",id LIMIT 16');
    for (const row of replays.rows) {
      if (stopped) break;
      await queue.add("replay", { operation: "replay", replayId: row.id }, { jobId: `replay-${row.id}` });
      await pool.query('UPDATE "FirstStackReplay" SET delivered=true,"deliveredAt"=CURRENT_TIMESTAMP WHERE id=$1 AND NOT delivered AND status<>\'terminal\'', [row.id]);
    }
    await reconcileSubmissionQueue(pool, queue, configuration.control.identity);
    if (Date.now() - lastPrune > 60000) {
      await pruneVerificationJobs(queue); lastPrune = Date.now();
    }
  };
  const tick = () => {
    poll = deliver().then(() => { lastDelivery = Date.now(); }).catch(fail).finally(() => {
      if (!stopped) timer = setTimeout(tick, 1000);
    });
  };
  try {
    await queue.setGlobalConcurrency(1);
    await ownership.assertHeld();
    // Validate under the same session lock used by releases; earlier checks can
    // become stale while a migration acquires and releases ownership.
    await checkHistory(pool); await checkSchemaGuards(pool);
    await markSubmissionRecovery(pool);
    await worker.waitUntilReady();
    const backend = worker.getBackend();
    for (const connection of [await queue.getBackend().client, await backend.client, await backend.blockingClient]) {
      connection?.on("close", fail); connection?.on("error", fail);
    }
    await deliver(); lastDelivery = Date.now();
    loop = worker.run();
    void loop.then(() => { if (!stopped) { lost = true; fail(); } })
      .catch(() => { lost = true; fail(); });
    tick();
  } catch (error) {
    stopped = true;
    await worker.close(true); await queue.close(); await ownership.close();
    configuration.healthy = previousHealthy;
    pool.off("error", fail); throw error;
  }
  async function health(isDraining = () => false) {
    await ownership.assertHeld();
    const backend = worker.getBackend();
    const connections = [await queue.getBackend().client, await backend.client, await backend.blockingClient];
    if (lost || !worker.isRunning() || connections.some(c => c?.status !== "ready") ||
      (!isDraining() && (stopped || worker.isPaused() || Date.now() - lastDelivery > 5000))) {
      throw Error("Verifier queue or outbox unavailable");
    }
    if (!isDraining()) {
      const lag = await pool.query(`SELECT EXISTS (SELECT 1 FROM "FirstStackOutbox"
        WHERE NOT delivered AND "createdAt" < CURRENT_TIMESTAMP - INTERVAL '15 seconds')
        OR EXISTS (SELECT 1 FROM "FirstStackReplay" WHERE NOT delivered AND status='queued'
        AND "createdAt" < CURRENT_TIMESTAMP - INTERVAL '15 seconds') AS stale`);
      // Shutdown can begin while either DB query is pending. Dispatch freshness
      // stops mattering during drain; ownership/connections/loop must stay healthy.
      if (!isDraining() && lag.rows[0]?.stale !== false) throw Error("Verifier outbox delivery stale");
    }
  }
  const replay = {
    async availability(owner: string, runId: string) {
      const row = await ownedReplayRow(pool, owner, runId);
      try {
        await health();
        if (!replayPolicy.enabled || !verifierExecutionAllowed(configuration)) {
          throw Error("Historical replay disabled; report remains readable");
        }
        historicalReplayTarget(row, configuration);
        return { replay: "available" as const, reasons: ["Qualified pinned executor can verify the retained server prefix; report reading does not execute."] };
      } catch (error) { return { replay: "unavailable" as const, reasons: [error instanceof Error ? error.message : "Historical replay unavailable"] }; }
    },
    async request(owner: string, runId: string) {
      if (!replayPolicy.enabled || stopped) throw new NotFoundError();
      await health();
      if (!verifierExecutionAllowed(configuration)) throw new AppError("Verification unavailable", 503);
      requireCapability(owner, { capability: "run.control", runId, control: "verify-recorded-prefix" });
      const row = await ownedReplayRow(pool, owner, runId), cut = historicalReplayTarget(row, configuration);
      return submissionTransaction(pool, async db => {
        if (!requireSubmissionStorage(await submissionStorage(db), 32768, true)) throw new AppError("Replay storage busy", 503);
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
      requireCapability(owner, { capability: "run.control", runId, control: "cancel-replay" });
      await submissionTransaction(pool, async db => {
        const row = (await db.query('SELECT * FROM "FirstStackReplay" WHERE id=$1 AND "runId"=$2 AND "ownerId"=$3 FOR UPDATE', [id, runId, owner])).rows[0];
        if (!row) throw new NotFoundError();
        if (row.status === "terminal") return;
        if (row.status === "queued") await db.query('UPDATE "FirstStackReplay" SET cancelled=true,status=\'terminal\',result=$2 WHERE id=$1', [id, { kind: "Unavailable", reason: "Replay cancelled before executor ownership" }]);
        else await db.query('UPDATE "FirstStackReplay" SET cancelled=true WHERE id=$1', [id]);
      });
    },
  };
  let closing: Promise<void> | undefined;
  return { queue, worker, replay, health,
    operations: async () => ({ queue: await queueOperations(pool, queue), storage: await submissionStorage(pool) }),
    close: () => closing ??= boundedVerifierDrain((async () => {
    stopped = true; clearTimeout(timer);
    // Local pause stops fetching immediately; the current whole scored job keeps ownership.
    await Promise.all([poll, drainVerifierWorker(worker, loop!)]);
    await queue.close();
    await ownership.close(); pool.off("error", fail);
    configuration.healthy = previousHealthy;
  })(), () => { lost = true; fail(); }) };
}
