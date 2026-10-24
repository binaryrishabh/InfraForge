import { expect, test } from "bun:test";
import { Client, Pool } from "pg";
import Redis from "ioredis";
import { Queue, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { startSubmissionQueue } from "../../firstStack/submissionQueue";
import { appendSubmissionResult, closeSubmissionRecovery, createSubmissionService } from "../../firstStack/admission";
import { pruneVerificationJobs, reconcileSubmissionQueue, verificationJobOptions } from "../../firstStack/queueOperations";
import { verifierExecutionAllowed } from "../../firstStack/submissionWorker";
import { submissionStorage } from "../../firstStack/submissionStorage";
import { assertReleaseIdle } from "../../release/migrations";
import { submissionFixture } from "../submissionFixture";
import { qualifiedVerifierFixture } from "../qualifiedVerifierFixture";

const url = process.env.INTEGRATION_RUN === "1" ? process.env.INTEGRATION_DATABASE_URL : undefined;
async function until(check: () => Promise<boolean>, maximum = 15000) {
  const deadline = Date.now() + maximum;
  while (!await check()) { if (Date.now() > deadline) throw Error("Queue recovery integration deadline"); await Bun.sleep(25); }
}
(url ? test : test.skip)("lost/failed/stalled jobs retain recovery; Redis retention and actual history accounting are bounded", async () => {
  const parsed = new URL(url!);
  const port = Number(process.env.INTEGRATION_REDIS_PORT);
  if (process.env.INTEGRATION_DISPOSABLE !== "local-only" || !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    !/^\/infraforge_it_[a-f0-9]+$/.test(parsed.pathname) || parsed.search || !Number.isInteger(port) || port < 1024 || port === 6379) throw Error("Disposable loopback Postgres/Redis required");
  const admin = new Client({ connectionString: url }); await admin.connect();
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`, target = new URL(url!); target.pathname = `/${name}`;
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  const migration = Bun.spawn([process.execPath, "--no-env-file", "--no-install", "run", "db:migrate"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), stdout: "ignore", stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), DATABASE_URL: target.href } });
  const diagnostic = await new Response(migration.stderr).text();
  if (await migration.exited !== 0) { await admin.query(`DROP DATABASE "${name}"`); await admin.end(); throw Error(`Migration failed: ${diagnostic.slice(-1000)}`); }
  const pool = new Pool({ connectionString: target.href, max: 4, query_timeout: 5000 });
  const options = { host: "127.0.0.1", port, enableOfflineQueue: false, connectTimeout: 2000 };
  const producer = new Redis({ ...options, maxRetriesPerRequest: 1, commandTimeout: 2000 });
  const consumer = new Redis({ ...options, maxRetriesPerRequest: null });
  const prefix = `recovery-${randomUUID()}`;
  let live: Awaited<ReturnType<typeof startSubmissionQueue>> | undefined, orphan: Worker | undefined;
  const f = await submissionFixture(randomUUID());
  let beforeCut: () => Promise<void> = async () => {};
  const { fixture, configuration } = qualifiedVerifierFixture(f.engine, () => beforeCut());
  const service = createSubmissionService(pool, { enabled: true, engine: f.engine, available: async () => true });
  const status = async (id: string) => (await pool.query('SELECT * FROM "FirstStackWork" WHERE "runId"=$1', [id])).rows[0];
  const results = async (id: string) => (await pool.query('SELECT body FROM "FirstStackResult" WHERE "runId"=$1', [id])).rows;
  const completed = async (id: string) => (await live!.queue.getJob(id))?.getState().then(state => state === "completed") ?? false;
  const close = async (id: string) => { const row = await status(id); await closeSubmissionRecovery(pool, id,
    { token: row.token, daemon: row.daemon, image: f.engine.image, cleanup: "not-created", reviewer: "integration operator", proof: "No executor launched for this quarantined submission; qualified controls ran separately" }); };
  try {
    await pool.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,$1,$2,CURRENT_TIMESTAMP)', [f.owner, `${f.owner}@example.invalid`]);
    await pool.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt") VALUES ($1,$2,$2,\'recovery fixture\',$3,$4)', [f.request.infrastructureId, f.owner, f.layout, f.request.expectedDesignUpdatedAt]);
    live = await startSubmissionQueue(pool, target.href, producer, consumer, configuration, { enabled: false }, () => {}, prefix);
    expect(verifierExecutionAllowed(configuration)).toBe(true);
    const positive = await service.submit(f.owner, { ...f.request, idempotencyKey: "positive-control" });
    await until(() => completed(positive.id));
    expect(fixture.launches).toBe(1); expect(fixture.removed).toBe(1);
    expect((await results(positive.id))[0].body.verification).toBe("verified");
    expect((await status(positive.id)).status).toBe("terminal");
    expect((await submissionStorage(pool)).liveReservedBytes).toBe(0);

    // Reconciler reads queued, then receives a stale missing-job response after
    // the real worker has claimed and launched. Hold the protocol at its cut.
    await live.worker.pause();
    const race = await service.submit(f.owner, { ...f.request, idempotencyKey: "claim-race" });
    await until(async () => (await pool.query('SELECT delivered FROM "FirstStackOutbox" WHERE "runId"=$1', [race.id])).rows[0].delivered);
    let observed = false, began = false;
    const lookup = Promise.withResolvers<undefined>(), release = Promise.withResolvers<void>();
    beforeCut = async () => { began = true; await release.promise; };
    const reconciliation = reconcileSubmissionQueue(pool, { getJob: async () => {
      observed = true; return lookup.promise;
    } }, fixture.control.identity).then(() => undefined, error => error);
    try {
      await until(async () => observed);
      live.worker.resume();
      await until(async () => began);
      const claimed = await status(race.id);
      expect(claimed.status).toBe("running");
      lookup.resolve(undefined);
      expect(await reconciliation).toBeUndefined();
      expect(await status(race.id)).toEqual(claimed);
      expect(await results(race.id)).toEqual([]);
      expect((await live.operations()).queue.reconciled30d).toBe(0);
    } finally { lookup.resolve(undefined); release.resolve(); await reconciliation; beforeCut = async () => {}; }
    await until(() => completed(race.id));
    expect((await results(race.id))[0].body.verification).toBe("verified");
    expect(fixture.launches).toBe(2); expect(fixture.removed).toBe(2);
    const launches = fixture.launches;
    await pool.query('INSERT INTO "FirstStackQueueEvent" (kind,"createdAt") VALUES (\'failed\',CURRENT_TIMESTAMP-INTERVAL \'31 days\')');
    await until(async () => (await pool.query('SELECT count(*)::int AS n FROM "FirstStackQueueEvent" WHERE "createdAt"<CURRENT_TIMESTAMP-INTERVAL \'30 days\'')).rows[0].n === 0);
    await live.worker.pause();
    const lost = await service.submit(f.owner, f.request);
    await until(async () => Boolean(await live!.queue.getJob(lost.id)));
    await until(async () => (await pool.query('SELECT delivered FROM "FirstStackOutbox" WHERE "runId"=$1', [lost.id])).rows[0].delivered);
    const liveUsage = await submissionStorage(pool);
    expect(liveUsage.liveReservedBytes).toBeGreaterThan(32 * 1024 ** 2);
    await (await live.queue.getJob(lost.id))!.remove();
    await until(async () => (await status(lost.id)).status === "recovery");
    expect((await submissionStorage(pool)).liveReservedBytes).toBe(liveUsage.liveReservedBytes);
    expect((await live.operations()).queue).toMatchObject({ recovery: 1, reconciled30d: 1 });
    await expect(close(lost.id)).rejects.toThrow("Stop verifier");
    await expect(assertReleaseIdle(pool)).rejects.toThrow("reservations");
    expect(await results(lost.id)).toEqual([]);
    const quarantined = await status(lost.id);
    for (let i = 0; i < 2; i++) {
      expect(verifierExecutionAllowed(configuration)).toBe(true);
      await live.queue.add("verify", { runId: lost.id }, { jobId: lost.id });
      live.worker.resume();
      await until(() => completed(lost.id));
      expect(fixture.launches).toBe(launches);
      expect(await status(lost.id)).toEqual(quarantined);
      expect(await results(lost.id)).toEqual([]);
      expect((await submissionStorage(pool)).liveReservedBytes).toBe(liveUsage.liveReservedBytes);
      await (await live.queue.getJob(lost.id))!.remove();
    }
    await live.close(); live = undefined; await close(lost.id);
    await assertReleaseIdle(pool);
    const history = await submissionStorage(pool);
    expect(history.liveReservedBytes).toBe(0); expect(history.historyBytes).toBeGreaterThan(0);
    // Terminal history no longer charges its unused 32 MiB execution reservation.
    const next = await service.submit(f.owner, { ...f.request, idempotencyKey: "stalled" });
    const transport = new Queue("first-stack-verification", { prefix, connection: producer, defaultJobOptions: verificationJobOptions });
    try {
      await transport.add("verify", { runId: next.id }, { jobId: next.id });
      await pool.query('UPDATE "FirstStackOutbox" SET delivered=true WHERE "runId"=$1', [next.id]);
      orphan = new Worker("first-stack-verification", async () => {}, { prefix, connection: consumer, autorun: false, lockDuration: 1000 });
      await orphan.waitUntilReady();
      expect((await orphan.getNextJob("dead-worker", { block: false }))?.id).toBe(next.id);
      await orphan.close(true); orphan = undefined;
      live = await startSubmissionQueue(pool, target.href, producer, consumer, configuration, { enabled: false }, () => {}, prefix);
      await until(async () => (await live!.operations()).queue.stalled30d > 0, 70000);
      await until(async () => (await status(next.id)).status === "recovery", 15000);
      expect((await live.operations()).queue.failed30d).toBeGreaterThan(0);
      expect(verifierExecutionAllowed(configuration)).toBe(true);
      expect(fixture.launches).toBe(launches);
      // A malformed delivery also fails before the DB claim and is observable.
      const before = (await live.operations()).queue.failed30d;
      await transport.add("verify", { runId: "invalid" });
      await until(async () => (await live!.operations()).queue.failed30d > before);
      await live.close(); live = undefined; await close(next.id);
      // Real BullMQ transitions exercise count retention for both terminal sets.
      const cleaner = new Worker("first-stack-verification", async job => { if (job.data.fail) throw Error("retention fixture"); }, { prefix, connection: consumer });
      try {
        for (let i = 0; i < 140; i++) await transport.add("retained", {}, { jobId: `complete-${i}` });
        for (let i = 0; i < 270; i++) await transport.add("retained", { fail: true }, { jobId: `fail-${i}` });
        await until(async () => (await transport.getWaitingCount()) === 0 && (await transport.getActiveCount()) === 0);
        await pruneVerificationJobs(transport);
        expect(await transport.getCompletedCount()).toBeLessThanOrEqual(128);
        expect(await transport.getFailedCount()).toBeLessThanOrEqual(256);
        expect((await pool.query('SELECT count(*)::int AS n FROM "FirstStackRun"')).rows[0].n).toBe(4);
      } finally { await cleaner.close(); }
      // Terminal private rows store bytes, but consume no live reservation.
      await service.submit(f.owner, { ...f.request, idempotencyKey: "private", purpose: "private" });
      expect((await submissionStorage(pool)).liveReservedBytes).toBe(0);
      expect((await submissionStorage(pool)).historyBytes).toBeGreaterThan(history.historyBytes);
      const audit = await service.submit(f.owner, { ...f.request, idempotencyKey: "audit" });
      await pool.query('UPDATE "FirstStackWork" SET status=\'running\',token=$2,daemon=$3 WHERE "runId"=$1', [audit.id, randomUUID(), fixture.control.identity]);
      await pool.query('INSERT INTO "FirstStackCut" ("runId",sequence,body) VALUES ($1,1,$2)', [audit.id, f.request.browserCut]);
      const fullAudit = { verification: "interrupted", score: { workloads: [{ input: "hidden fixture input".repeat(100), evidence: f.request.browserCut }] } };
      await appendSubmissionResult(pool as any, audit.id, fullAudit);
      await pool.query('UPDATE "FirstStackWork" SET status=\'terminal\' WHERE "runId"=$1', [audit.id]);
      const sizes = (await pool.query('SELECT sum(octet_length(body::text))::int AS bytes FROM "FirstStackResult"')).rows[0];
      expect((await submissionStorage(pool)).resultBytes).toBe(sizes.bytes);
      expect((await submissionStorage(pool)).cutBytes).toBeGreaterThan(0);
      expect(JSON.stringify(await submissionStorage(pool))).not.toContain("hidden fixture");
      const full = await service.submit(f.owner, { ...f.request, idempotencyKey: "full-capture" });
      await pool.query('UPDATE "FirstStackWork" SET status=\'running\',token=$2,daemon=$3,"captureBytes"=33550336 WHERE "runId"=$1', [full.id, randomUUID(), fixture.control.identity]);
      await expect(appendSubmissionResult(pool as any, full.id, { verification: "interrupted" })).rejects.toThrow("preserve recovery");
      await pool.query('UPDATE "FirstStackWork" SET status=\'recovery\' WHERE "runId"=$1', [full.id]);
      await close(full.id);
      expect((await status(full.id)).status).toBe("terminal");
    } finally { await transport.close(); }
  } finally {
    await orphan?.close(true); await live?.close();
    const cleanup = new Queue("first-stack-verification", { prefix, connection: producer });
    await cleanup.obliterate({ force: true }); await cleanup.close();
    producer.disconnect(); consumer.disconnect(); await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end();
  }
}, 180000);
