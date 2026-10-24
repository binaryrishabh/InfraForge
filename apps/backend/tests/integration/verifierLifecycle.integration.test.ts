import { expect, spyOn, test } from "bun:test";
import { Client, Pool } from "pg";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { startSubmissionQueue } from "../../firstStack/submissionQueue";
import { createSubmissionService } from "../../firstStack/admission";
import { isolationPolicyHash, qualificationChecks, type HostQualification } from "../../firstStack/isolationPolicy";
import { publicChallenge, serverChallenges } from "../../firstStack/scoredChallenges/definition";
import { canonical, designRevision } from "../../firstStack/canonical";
import { fixtureCut, verifierProtocolFixture } from "../verifierProtocolFixture";
import { assertNoWorker } from "../../release/migrations";
import type { SubmissionVerifier } from "../../firstStack/submissionWorker";
import { acquireVerifierOwnership, verifierLock } from "../../firstStack/verifierOwnership";
import { fixtureChallenges, fixtureDefinition } from "../scoringFixtures";

const url = process.env.INTEGRATION_RUN === "1" ? process.env.INTEGRATION_DATABASE_URL : undefined;
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 15000;
  while (!await check()) {
    if (Date.now() > deadline) throw Error("Verifier integration deadline");
    await Bun.sleep(25);
  }
}
// Bun 1.3.14 on Windows segfaults in a background thread during this test (reproduced
// 2026-10-24); it passes repeatedly on Linux, where CI and production run it.
const supported = url && process.platform !== "win32";
(supported ? test : test.skip)(
  "real queue owns recovery once, fails closed, drains scored work and preserves reads", async () => {
  const parsed = new URL(url!);
  if (process.env.INTEGRATION_DISPOSABLE !== "local-only" ||
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    !/^\/infraforge_it_[a-f0-9]+$/.test(parsed.pathname) || parsed.search) {
    throw Error("Explicit disposable local integration database required");
  }
  const admin = new Client({ connectionString: url }); await admin.connect();
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`, target = new URL(url!);
  target.pathname = `/${name}`;
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  const migration = Bun.spawn([process.execPath, "--no-env-file", "--no-install", "run", "db:migrate"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), stdout: "ignore", stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      DATABASE_URL: target.href } });
  const diagnostic = await new Response(migration.stderr).text();
  if (await migration.exited !== 0) throw Error(`Disposable migration failed: ${diagnostic.slice(-2000)}`);
  const pool = new Pool({ connectionString: target.href, max: 4, query_timeout: 2000 });
  // A unique BullMQ prefix isolates all keys from the shared integration service.
  const prefix = `verifier-test-${randomUUID()}`;
  const options = { host: "127.0.0.1", port: Number(process.env.INTEGRATION_REDIS_PORT ?? 56379),
    enableOfflineQueue: false, connectTimeout: 2000 };
  const producer = new Redis({ ...options, maxRetriesPerRequest: 1, commandTimeout: 2000 });
  const consumer = new Redis({ ...options, maxRetriesPerRequest: null });
  let queue: Awaited<ReturnType<typeof startSubmissionQueue>> | undefined;
  let release!: () => void, began!: () => void, invalidations = 0, healthy = true;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const running = new Promise<void>(resolve => { began = resolve; });
  const engine = { source: "a".repeat(64), image: `sha256:${"b".repeat(64)}` };
  const fixture = verifierProtocolFixture(engine, async () => { began(); await blocked; });
  const qualification: HostQualification = { schema: "first-stack-host/1", target: "ec2-c7i-flex.large",
    ...engine, daemon: fixture.control.identity, policy: isolationPolicyHash, capacity: 1, qualified: true,
    checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
    checks: Object.fromEntries(qualificationChecks.map(k => [k, true])) as HostQualification["checks"] };
  const configuration: SubmissionVerifier = { admission: { enabled: true, engine },
    isolation: { ...engine, qualification }, control: fixture.control, healthy: () => healthy };
  // Admission and the queue worker use the default registry. Bind both to the
  // fake v2 commitments/store for this test, without configuring a private store.
  const definitionSpy = spyOn(serverChallenges, "definition").mockImplementation(fixtureChallenges.definition);
  const scoringSpy = spyOn(serverChallenges, "scoring").mockImplementation(fixtureChallenges.scoring);
  try {
    healthy = true;
    queue = await startSubmissionQueue(pool, target.href, producer, consumer, configuration,
      { enabled: false }, () => { invalidations++; healthy = false; }, prefix);
    await until(async () => { try { await queue!.health(); return true; } catch { return false; } });
    await expect(assertNoWorker(pool)).rejects.toThrow();
    await expect(startSubmissionQueue(pool, target.href, producer, consumer, configuration,
      { enabled: false }, () => {}, prefix)).rejects.toThrow("Another");
    const owner = randomUUID(), infrastructureId = randomUUID();
    const sample = await publicChallenge(owner, "lose-an-app-server", "2", fixtureChallenges);
    const input = canonical({ owner, layout: sample.layout, candidate: sample.layout.firstStack,
      recording: sample.workload, policy: sample.policy });
    const updated = "2026-10-23T00:00:00.000Z";
    await pool.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,$1,$2,CURRENT_TIMESTAMP)',
      [owner, `${owner}@example.invalid`]);
    await pool.query(`INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt")
      VALUES ($1,$2,$2,'verifier fixture',$3,$4)`, [infrastructureId, owner, sample.layout, updated]);
    const service = createSubmissionService(pool, { enabled: true, engine, available: async () => {
      try { await queue!.health(); return true; } catch { return false; }
    } });
    const request = { infrastructureId, expectedDesignUpdatedAt: updated,
      expectedDesignRevision: designRevision(sample.layout), idempotencyKey: randomUUID(), purpose: "scored",
      engine, workload: sample.workload, policy: sample.policy, challenge: { id: sample.id, version: sample.version },
      browserCut: fixtureCut(input, engine.source) };
    // Missing and expired qualification cannot launch even when dispatch is live.
    for (const q of [null, { ...qualification, expiresAt: new Date(Date.now() - 1).toISOString() }]) {
      configuration.isolation.qualification = q;
      const run = await service.submit(owner, { ...request, idempotencyKey: randomUUID() });
      await until(async () => (await pool.query('SELECT status FROM "FirstStackWork" WHERE "runId"=$1',
        [run.id])).rows[0].status === "terminal");
      expect((await pool.query('SELECT body FROM "FirstStackResult" WHERE "runId"=$1', [run.id]))
        .rows[0].body.verification).toBe("unavailable");
      expect(fixture.launches).toBe(0);
    }
    configuration.isolation.qualification = qualification;
    const run = await service.submit(owner, request);
    await running;
    let drained = false;
    const closing = queue.close().then(() => { drained = true; });
    await Bun.sleep(30); expect(drained).toBe(false);
    await expect(queue.health()).rejects.toThrow();
    release(); await closing;
    expect(fixture.launches).toBeGreaterThan(1); expect(fixture.removed).toBe(fixture.launches);
    const result = (await pool.query('SELECT body FROM "FirstStackResult" WHERE "runId"=$1', [run.id])).rows[0].body;
    expect(result.verification).toBe("verified"); expect(result.score).toBeDefined();
    expect(result.score.schema).toBe("infraforge-server-score/1");
    expect(result.score.challenge).toMatchObject({ id: sample.id, version: "2" });
    expect(result.score.workloads).toHaveLength(fixtureDefinition(sample.id).hidden.length);
    const disabled = createSubmissionService(pool);
    expect((await disabled.read(owner, run.id)).reference?.id).toBe(run.id);
    await expect(disabled.submit(owner, request)).rejects.toThrow("Resource");
    await assertNoWorker(pool);
    let lost = false;
    const ownership = await acquireVerifierOwnership(target.href, () => { lost = true; });
    await pool.query(`SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory'
      AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND classid=$1::oid AND objid=$2::oid AND objsubid=2`, verifierLock);
    await until(async () => lost);
    expect(ownership.held).toBe(false);
    await expect(ownership.assertHeld()).rejects.toThrow("lost"); await ownership.close();
    healthy = true;
    queue = await startSubmissionQueue(pool, target.href, producer, consumer, configuration,
      { enabled: false }, () => { invalidations++; healthy = false; }, prefix);
    await until(async () => { try { await queue!.health(); return true; } catch { return false; } });
    const before = invalidations;
    const blocking = await queue.worker.getBackend().blockingClient;
    blocking!.disconnect();
    await until(async () => invalidations > before);
    await expect(queue.health()).rejects.toThrow();
    await expect(service.submit(owner, { ...request, idempotencyKey: randomUUID() })).rejects.toThrow("unavailable");
    // BullMQ may already be reconnecting its blocking client; only reconnect a closed one.
    if (blocking!.status === "end" || blocking!.status === "close") await blocking!.connect();
    await until(async () => { try { await queue!.health(); return true; } catch { return false; } });
  } finally {
    try {
      release(); await queue?.close();
      const cleanup = new Queue("first-stack-verification", { prefix, connection: producer });
      await cleanup.obliterate({ force: true }); await cleanup.close();
      producer.disconnect(); consumer.disconnect(); await pool.end();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end();
    } finally {
      definitionSpy.mockRestore(); scoringSpy.mockRestore();
    }
  }
}, 120000);
