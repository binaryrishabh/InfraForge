import { expect } from "bun:test";
import type { PoolClient } from "pg";
import { LocalHarness, until } from "./localHarness";
// Test-only PostgreSQL barriers. No application delay/failure switch is installed.
export async function captureBarrier(h: LocalHarness, sequence = 4) {
  const lock = await h.sql.connect();
  let closed = false;
  await lock.query("SELECT pg_advisory_lock(186542854,3)");
  await h.sql.query(`CREATE FUNCTION model2_fixture_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.sequence=${sequence} AND NEW.sequence<>OLD.sequence THEN PERFORM pg_advisory_xact_lock(186542854,3); END IF; RETURN NEW; END; $$;
    CREATE TRIGGER model2_fixture_barrier BEFORE UPDATE ON "InternalModel2Run" FOR EACH ROW EXECUTE FUNCTION model2_fixture_barrier()`);
  return {
    async waiting() { return until(async () => {
      const rows = (await h.sql.query(`SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid
        WHERE l.locktype='advisory' AND l.classid=186542854::oid AND l.objid=3::oid AND NOT l.granted AND a.datname=current_database()`)).rows;
      return rows[0]?.pid as number | undefined;
    }, "actual worker capture transaction waiting at barrier"); },
    async release() { await lock.query("SELECT pg_advisory_unlock(186542854,3)"); },
    async close() {
      if (closed) return; closed = true;
      await lock.query("SELECT pg_advisory_unlock_all()").catch(() => {}); lock.release();
      await h.sql.query('DROP TRIGGER IF EXISTS model2_fixture_barrier ON "InternalModel2Run"; DROP FUNCTION IF EXISTS model2_fixture_barrier()');
    }
  };
}
export async function alterRecordedField(h: LocalHarness, id: string, column: "input" | "evidence", value: unknown, check: () => Promise<void>) {
  const db: PoolClient = await h.sql.connect();
  try {
    await db.query("BEGIN");
    await db.query('ALTER TABLE "InternalModel2Run" DISABLE TRIGGER internal_model2_guard');
    await db.query(`UPDATE "InternalModel2Run" SET "${column}"=$2 WHERE id=$1`, [id, value]);
    await db.query('ALTER TABLE "InternalModel2Run" ENABLE TRIGGER internal_model2_guard');
    await db.query("COMMIT");
    await check();
  } finally { db.release(); }
}
export async function verifyOwnershipLoss(h: LocalHarness, workerPid: number) {
  const held = (await h.sql.query(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory'
    AND classid=186542854::oid AND objid=1::oid AND granted) AS held`, [workerPid])).rows[0].held;
  expect(held).toBe(true);
  expect((await h.sql.query("SELECT pg_terminate_backend($1) AS terminated", [workerPid])).rows[0].terminated).toBe(true);
  expect(await h.waitForExit("worker")).not.toBe(0);
  await h.stop("worker");
}
