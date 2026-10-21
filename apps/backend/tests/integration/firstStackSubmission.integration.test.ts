import { expect, test } from "bun:test";
import { Pool, Client } from "pg";
import { randomUUID } from "node:crypto";
import { createSubmissionService } from "../../firstStack/admission";
import { createSubmissionFence, markSubmissionRecovery } from "../../firstStack/submissionWorker";
import { withFirstStackOwnership } from "../../firstStack/isolationOwnership";
import { checkFirstStackSchema } from "../../release/firstStackSchema";
import { hash } from "../../firstStack/canonical";
import { submissionFixture } from "../submissionFixture";

const url = process.env.FIRST_STACK_TEST_DATABASE;
async function rejected(promise: Promise<unknown>, text?: string) {
  let error: unknown; try { await promise; } catch (e) { error = e; }
  expect(error).toBeInstanceOf(Error);
  if (text) expect((error as Error).message).toContain(text);
}
(url ? test : test.skip)("owned admission is atomic, bounded, immutable and fenced through cancellation/restart", async () => {
  const parsed = new URL(url!);
  if (process.env.INTEGRATION_DISPOSABLE !== "local-only" || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/infraforge_isolation" || parsed.search) throw Error("Explicit disposable local isolation database required");
  const pool = new Pool({ connectionString: url, max: 4, query_timeout: 5000 }), f = await submissionFixture();
  const service = createSubmissionService(pool, { enabled: true, engine: f.engine });
  const db = new Client({ connectionString: url }); await db.connect();
  // One fresh disposable database per invocation. No history is deleted here.
  try {
    await checkFirstStackSchema(pool);
    await pool.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,$1,$2,CURRENT_TIMESTAMP)', [f.owner, `${f.owner}@example.invalid`]);
    await pool.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt") VALUES ($1,$2,$2,\'submission fixture\',$3,$4)', [f.request.infrastructureId, f.owner, f.layout, f.request.expectedDesignUpdatedAt]);
    const [first, duplicate] = await Promise.all([service.submit(f.owner, f.request), service.submit(f.owner, f.request)]);
    expect(first.id).toBe(duplicate.id); expect([first.reused, duplicate.reused].sort()).toEqual([false, true]);
    expect((await pool.query('SELECT count(*)::int AS count FROM "FirstStackRun"')).rows[0].count).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM "FirstStackOutbox"')).rows[0].count).toBe(1);
    await rejected(service.submit(f.owner, { ...f.request, purpose: "scored" }), "Idempotency");
    await rejected(service.read("someone-else", first.id), "Resource");
    await rejected(service.cancel("someone-else", first.id), "Resource");
    await rejected(service.submit("someone-else", f.request), "Saved design");
    await rejected(service.submit(f.owner, { ...f.request, idempotencyKey: "stale", expectedDesignRevision: "f".repeat(64) }), "Saved design changed");
    await rejected(service.submit(f.owner, { ...f.request, idempotencyKey: "forged", browserCut: { ...f.request.browserCut, fingerprint: "f".repeat(64) } }), "fingerprint");
    await rejected(service.submit(f.owner, { ...f.request, idempotencyKey: "capacity" }), "capacity busy");
    const stored = await service.read(f.owner, first.id);
    for (const sql of ['UPDATE "FirstStackRun" SET seed=\'changed\' WHERE id=$1', 'DELETE FROM "FirstStackRun" WHERE id=$1']) await rejected(pool.query(sql, [first.id]), "append-only");
    for (const edit of [
      { engine: {} }, { lock: {} }, { input: "{}", inputBytes: 2, reservedBytes: 33554434 }, { inputBytes: 0 },
    ]) await rejected(pool.query(`INSERT INTO "FirstStackRun" SELECT (jsonb_populate_record(NULL::"FirstStackRun",to_jsonb(r)||$2::jsonb)).*
      FROM "FirstStackRun" r WHERE id=$1`, [first.id, { ...edit, id: randomUUID(), idempotencyKey: randomUUID() }]), "first_stack_input");
    await rejected(pool.query('UPDATE "FirstStackWork" SET status=\'terminal\' WHERE "runId"=$1', [first.id]), "requires immutable result");
    const challengeId = "00000000-0000-4000-8000-000000000025";
    await pool.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt","challengeId","challengeVersion") VALUES ($1,$2,$2,\'fixed fixture\',$3,$4,\'fixed\',1)', [challengeId, f.owner, f.layout, f.request.expectedDesignUpdatedAt]);
    await rejected(service.submit(f.owner, { ...f.request, infrastructureId: challengeId, idempotencyKey: "challenge" }), "Fixed challenge");
    await pool.query('UPDATE "FirstStackWork" SET status=\'running\',token=\'test-token\' WHERE "runId"=$1', [first.id]);
    const fence = createSubmissionFence(stored, "test-token");
    await withFirstStackOwnership(url!, fence, async (authority, signal) => {
      await authority.commit(f.request.browserCut, signal);
      await rejected(withFirstStackOwnership(url!, fence, async () => {}), "capacity busy");
      await rejected(createSubmissionFence(stored, "wrong-token").check(db), "lost");
      await service.cancel(f.owner, first.id);
      await rejected(authority.assertHeld(signal), "cancelled");
      await rejected(authority.commit({ ...f.request.browserCut, cut: { ...f.request.browserCut.cut, sequence: 2 } }, signal));
    });
    expect((await pool.query('SELECT count(*)::int AS count FROM "FirstStackCut"')).rows[0].count).toBe(1);
    await rejected(pool.query('DELETE FROM "FirstStackCut" WHERE "runId"=$1', [first.id]), "append-only");
    await markSubmissionRecovery(pool);
    expect((await service.read(f.owner, first.id)).status).toBe("recovery");
    await rejected(pool.query('UPDATE "FirstStackWork" SET status=\'queued\' WHERE "runId"=$1', [first.id]), "state transition");
    await rejected(service.submit(f.owner, { ...f.request, idempotencyKey: "still-reserved" }), "capacity busy");
    const privateRun = await service.submit(f.owner, { ...f.request, idempotencyKey: "private", purpose: "private" });
    const privateRead = await service.read(f.owner, privateRun.id);
    expect(privateRead.result.verification).toBe("unverified"); expect(privateRead.resultHash).toBe(hash(privateRead.result));
    await rejected(pool.query('UPDATE "FirstStackResult" SET body=\'{}\' WHERE "runId"=$1', [privateRun.id]), "append-only");
    // Ten successful submissions per owner/hour, including private runs. Lost
    // responses still reuse an existing run after the limit is reached.
    for (let i = 0; i < 8; i++) await service.submit(f.owner, { ...f.request, idempotencyKey: `rate-${i}`, purpose: "private" });
    await rejected(service.submit(f.owner, { ...f.request, idempotencyKey: "rate-exceeded", purpose: "private" }), "rate exceeded");
    expect((await service.submit(f.owner, f.request)).id).toBe(first.id);
    for (let i = 0; i < 16; i++) {
      const other = await submissionFixture(`other-${i}`), infrastructureId = randomUUID();
      await pool.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,$1,$2,CURRENT_TIMESTAMP)', [other.owner, `${other.owner}@example.invalid`]);
      await pool.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt") VALUES ($1,$2,$2,\'capacity fixture\',$3,$4)', [infrastructureId, other.owner, other.layout, other.request.expectedDesignUpdatedAt]);
      const submission = service.submit(other.owner, { ...other.request, infrastructureId });
      if (i < 15) await submission;
      else await rejected(submission, "capacity busy");
    }
    expect((await pool.query('SELECT count(*)::int AS count FROM "FirstStackWork" WHERE status<>\'terminal\'')).rows[0].count).toBe(16);
  } finally { await db.end(); await pool.end(); }
}, 60000);
