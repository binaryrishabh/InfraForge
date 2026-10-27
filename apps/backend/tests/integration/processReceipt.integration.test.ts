import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { appendSubmissionResult, closeSubmissionRecovery, createSubmissionService, submissionTransaction } from "../../firstStack/admission";
import { createSubmissionFence, markSubmissionRecovery } from "../../firstStack/submissionWorker";
import { migrationManifest } from "../../release/migrations";
import { checkFirstStackSchema } from "../../release/firstStackSchema";
import { submissionFixture } from "../submissionFixture";

const url = process.env.FIRST_STACK_TEST_DATABASE ?? (process.env.INTEGRATION_RUN === "1" ? process.env.INTEGRATION_DATABASE_URL : undefined);
describe.skipIf(!url)("process receipt PostgreSQL guards", () => {
  let admin: Client, pool: Pool, name: string, legacy: Awaited<ReturnType<typeof fixture>>, original: string;
  async function rejected(task: Promise<unknown>, message: string) {
    let failure: unknown;
    try { await task; } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(message);
  }
  async function fixture(process = true, claim = true) {
    const f = await submissionFixture(randomUUID()), infrastructureId = randomUUID();
    await pool.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,$1,$2,now())', [f.owner, `${f.owner}@example.invalid`]);
    await pool.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt") VALUES ($1,$2,$2,\'receipt fixture\',$3,$4)',
      [infrastructureId, f.owner, f.layout, f.request.expectedDesignUpdatedAt]);
    const service = createSubmissionService(pool, { enabled: true, engine: f.engine, available: async () => true });
    const { id } = await service.submit(f.owner, { ...f.request, infrastructureId });
    const token = randomUUID(), generation = randomUUID(), daemon = "c".repeat(64);
    if (claim) await pool.query(process ? 'UPDATE "FirstStackWork" SET status=\'running\',token=$2,generation=$3 WHERE "runId"=$1' :
      'UPDATE "FirstStackWork" SET status=\'running\',token=$2,daemon=$3 WHERE "runId"=$1', [id, token, process ? generation : daemon]);
    const receipt = process ? { schema: "first-stack-process-receipt/1", token, generation, ...f.engine,
      exit: { code: 0, signal: null }, termination: "confirmed" } :
      { schema: "first-stack-isolation-receipt/1", daemon, image: f.engine.image, container: "software-fixture",
        enforcement: null, elapsedMs: 1, outputBytes: 0, exit: { code: 0, oom: false }, cleanup: "removed" };
    const body = { verification: "verified", actual: f.request.browserCut.fingerprint, expected: f.request.browserCut.fingerprint, receipt };
    const run = { ...f, id, ownerId: f.owner, inputHash: f.request.browserCut.inputHash, token, generation: process ? generation : null, daemon: process ? null : daemon };
    return { ...f, id, service, token, generation, body, run, receipt,
      cut: () => pool.query('INSERT INTO "FirstStackCut" ("runId",sequence,body) VALUES ($1,1,$2)', [id, f.request.browserCut]) };
  }
  const result = (id: string) => pool.query('SELECT body,hash FROM "FirstStackResult" WHERE "runId"=$1', [id]).then(r => r.rows[0]);
  const finish = (f: Awaited<ReturnType<typeof fixture>>, body = f.body) => submissionTransaction(pool, async db => {
    await appendSubmissionResult(db, f.id, body);
    await db.query('UPDATE "FirstStackWork" SET status=\'terminal\' WHERE "runId"=$1', [f.id]);
  });
  beforeAll(async () => {
    const target = new URL(url!);
    if (process.env.INTEGRATION_DISPOSABLE !== "local-only" || !["localhost", "127.0.0.1"].includes(target.hostname) ||
      !/^\/(infraforge_isolation|infraforge_it_[a-f0-9]+)$/.test(target.pathname) || target.search) throw Error("Disposable local database required");
    admin = new Client({ connectionString: url }); await admin.connect();
    name = `infraforge_it_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); target.pathname = `/${name}`;
    pool = new Pool({ connectionString: target.href, max: 2 });
    const manifest = await migrationManifest();
    // Exercise an actual upgrade with an immutable old result already present.
    for (const migration of manifest.slice(0, -2)) await pool.query(await readFile(new URL(`../../prisma/migrations/${migration.name}/migration.sql`, import.meta.url), "utf8"));
    legacy = await fixture(false); await legacy.cut(); await finish(legacy); original = JSON.stringify(await result(legacy.id));
    expect(manifest.slice(-2).map(m => m.name)).toEqual(["20261027000000_first_stack_process_receipts", "20261027000001_validate_first_stack_work"]);
    for (const migration of manifest.slice(-2)) await pool.query(await readFile(new URL(`../../prisma/migrations/${migration.name}/migration.sql`, import.meta.url), "utf8"));
  }, 60000);
  afterAll(async () => {
    await pool?.end();
    if (name) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin?.end();
  });

  test("forward migration retains old evidence and release schema checks the new guards", async () => {
    await checkFirstStackSchema(pool);
    expect(JSON.stringify(await result(legacy.id))).toBe(original);
    expect((await legacy.service.read(legacy.owner, legacy.id)).availability?.report).toBe("readable");
    const f = await fixture(); await f.cut(); await finish(f);
    expect((await f.service.read(f.owner, f.id)).availability?.report).toBe("readable");
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("ALTER FUNCTION capture_first_stack_evidence() RENAME TO changed_process_guard");
      await rejected(checkFirstStackSchema(db as any), "guard differs");
    } finally { await db.query("ROLLBACK"); db.release(); }
  });

  test("forged completion and wrong token, generation, source, image or exit are rejected", async () => {
    const queued = await fixture(true, false);
    await rejected(pool.query('UPDATE "FirstStackWork" SET token=$2,generation=$3 WHERE "runId"=$1', [queued.id, queued.token, queued.generation]), "first_stack_work");
    await rejected(appendSubmissionResult(pool, queued.id, queued.body), "captured process ownership");
    await queued.service.cancel(queued.owner, queued.id);
    const f = await fixture();
    await rejected(appendSubmissionResult(pool, f.id, f.body), "complete acknowledged");
    await f.cut();
    for (const edit of [{ token: randomUUID() }, { generation: randomUUID() }, { source: "f".repeat(64) },
      { image: `sha256:${"f".repeat(64)}` }, { termination: "unconfirmed" }, { exit: null }, { cleanup: "removed" },
      { exit: { code: null, signal: null } }]) {
      await rejected(appendSubmissionResult(pool, f.id, { ...f.body, receipt: { ...f.receipt, ...edit } }), "matching ownership");
    }
    for (const edit of [{ exit: { code: 1, signal: null } }, { exit: { code: null, signal: "SIGKILL" } },
      { exit: null, termination: "not-started" }]) {
      await rejected(appendSubmissionResult(pool, f.id, { ...f.body, receipt: { ...f.receipt, ...edit } }), "complete acknowledged");
    }
    await rejected(appendSubmissionResult(pool, f.id, { ...f.body, actual: "f".repeat(64) }), "complete acknowledged");
    await rejected(appendSubmissionResult(pool, f.id, { ...f.body, verification: "mismatch" }), "complete acknowledged");
    await rejected(appendSubmissionResult(pool, f.id, { verification: "interrupted" }), "matching ownership");
    await finish(f);
  });

  test("cancellation and revocation retain process ownership until confirmed interruption", async () => {
    for (const cancelled of [true, false]) {
      const f = await fixture(); await f.cut();
      if (cancelled) await f.service.cancel(f.owner, f.id);
      else await pool.query('UPDATE "FirstStackWork" SET authorized=false WHERE "runId"=$1', [f.id]);
      const db = await pool.connect();
      try { await rejected(createSubmissionFence(f.run, f.token).check(db as any), "cancelled, revoked or lost"); }
      finally { db.release(); }
      await rejected(appendSubmissionResult(pool, f.id, f.body), "complete acknowledged");
      await rejected(appendSubmissionResult(pool, f.id, { ...f.body, verification: "mismatch" }), "complete acknowledged");
      await finish(f, { ...f.body, verification: "interrupted" });
      expect((await result(f.id)).body.verification).toBe("interrupted");
    }
  });

  test("recovery requires captured generation, source, token, image and offline service-stop review", async () => {
    const f = await fixture(); await f.cut(); await markSubmissionRecovery(pool);
    const review = { kind: "process-service-stopped/1", token: f.token, generation: f.generation, ...f.engine,
      termination: "confirmed", reviewer: "software fixture", proof: "No child launched in this PostgreSQL guard test" };
    await rejected(appendSubmissionResult(pool, f.id, f.body), "Recovery requires");
    for (const edit of [{ token: randomUUID() }, { generation: randomUUID() }, { source: "f".repeat(64) },
      { image: `sha256:${"f".repeat(64)}` }, { termination: "unconfirmed" }, { proof: "" }]) {
      await rejected(appendSubmissionResult(pool, f.id, { verification: "interrupted", recovery: { ...review, ...edit } }), "Recovery requires");
    }
    await rejected(closeSubmissionRecovery(pool, f.id, { ...review, generation: randomUUID() }), "Recovery identity");
    const owner = await pool.connect();
    try {
      for (const lock of [12, 10]) {
        await owner.query("SELECT pg_advisory_lock(186542854,$1)", [lock]);
        await rejected(closeSubmissionRecovery(pool, f.id, review), "Stop verifier");
        await owner.query("SELECT pg_advisory_unlock(186542854,$1)", [lock]);
      }
    } finally { await owner.query("SELECT pg_advisory_unlock_all()"); owner.release(); }
    await closeSubmissionRecovery(pool, f.id, review);
    expect((await result(f.id)).body.recovery).toEqual(review);
    expect((await f.service.read(f.owner, f.id)).availability?.report).toBe("readable");
  });

  test("process ownership, append-only evidence and reserved recovery size stay enforced", async () => {
    const f = await fixture(); await f.cut();
    for (const assignment of [`generation='${randomUUID()}'`, `token='${randomUUID()}'`, `daemon='${"c".repeat(64)}'`]) {
      await rejected(pool.query(`UPDATE "FirstStackWork" SET ${assignment} WHERE "runId"=$1`, [f.id]), assignment.startsWith("daemon") ? "first_stack_work" : "state transition");
    }
    const db = await pool.connect();
    try { await rejected(createSubmissionFence({ ...f.run, generation: randomUUID() }, f.token).check(db as any), "lost"); }
    finally { db.release(); }
    await rejected(pool.query('DELETE FROM "FirstStackCut" WHERE "runId"=$1', [f.id]), "append-only");
    await pool.query('UPDATE "FirstStackWork" SET "captureBytes"=33550336 WHERE "runId"=$1', [f.id]);
    await rejected(appendSubmissionResult(pool, f.id, f.body), "preserve recovery");
    await rejected(pool.query('UPDATE "FirstStackWork" SET "captureBytes"=33554433 WHERE "runId"=$1', [f.id]), "first_stack_work");
    await markSubmissionRecovery(pool);
    await closeSubmissionRecovery(pool, f.id, { kind: "process-service-stopped/1", token: f.token, generation: f.generation, ...f.engine,
      termination: "confirmed", reviewer: "software fixture", proof: "No child launched; reserved bytes permit closure" });
    await rejected(pool.query('UPDATE "FirstStackResult" SET body=\'{}\' WHERE "runId"=$1', [f.id]), "append-only");
    await rejected(pool.query('DELETE FROM "FirstStackResult" WHERE "runId"=$1', [f.id]), "append-only");
  });
});
