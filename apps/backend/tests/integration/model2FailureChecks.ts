import { expect } from "bun:test";
import { captureBarrier, verifyOwnershipLoss } from "./model2Barriers";
import { LocalHarness, until } from "./localHarness";
export async function checkModel2Failures(h: LocalHarness, create: (key: string) => Promise<string>, read: (id: string) => Promise<any>, owner: string) {
  const proof: Record<string, unknown> = {};
  const retained = (row: any) => ({ id: row.id, input: row.input, capture: row.evidence, status: row.status,
    reason: row.reason, retained: row.evidence.fingerprint, sequence: row.sequence, throughUs: row.throughUs });
  for (const loss of ["process-death", "ownership-loss"] as const) {
    const barrier = await captureBarrier(h); let id = "";
    try {
      id = await create(loss); const pid = await barrier.waiting();
      const before = await read(id);
      expect(before.status).toBe("running"); expect(before.sequence).toBe(3); expect(before.throughUs).toBe(2500);
      if (loss === "ownership-loss") await verifyOwnershipLoss(h, pid); else await h.stop("worker");
      const absent = (await h.request(`/internal/model2/runs/${id}/report`)).report;
      expect(absent.sequence).toBe(3); expect(absent.throughUs).toBe(2500); expect(absent.problems).toEqual([]);
      expect(absent.unknown.join(" ")).toContain("retained prefix");
      await barrier.release();
      // The failed transaction cannot commit its advanced state after ownership ends.
      expect((await read(id)).sequence).toBe(3);
      await barrier.close();
      await h.startWorker();
      const after = await until(async () => { const row = await read(id); return row.status === "interrupted" ? row : undefined; }, "interrupted internal run retirement");
      expect(after.sequence).toBe(3); expect(after.evidence.fingerprint).toBe(before.evidence.fingerprint);
      const replay = await h.request(`/internal/model2/runs/${id}/replay`);
      expect(replay.replay.kind).toBe("MatchesRecordedPrefix"); expect(replay.replay.complete).toBe(false);
      proof[loss] = { ...retained(after), before: before.evidence.fingerprint, replay: replay.replay.kind,
        reportWithoutWorker: { status: absent.status, sequence: absent.sequence, throughUs: absent.throughUs } };
    } finally { await barrier.close().catch(() => {}); }
  }
  await h.sql.query(`CREATE FUNCTION model2_fixture_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.sequence=4 AND NEW.sequence<>OLD.sequence THEN RAISE EXCEPTION 'fixture capture transaction failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER model2_fixture_write_failure BEFORE UPDATE ON "InternalModel2Run" FOR EACH ROW EXECUTE FUNCTION model2_fixture_write_failure()`);
  try {
    const id = await create("capture-transaction-failure");
    const row = await until(async () => { const r = await read(id); return r.status === "interrupted" ? r : undefined; }, "safe stop after failed evidence transaction");
    expect(row.sequence).toBe(3); expect(row.throughUs).toBe(2500);
    expect(row.evidence.model.objects[0].objects).toEqual([{ namespace: "n", key: "k", generation: 1, bytes: 10, content: "first" }]);
    expect((await h.request(`/internal/model2/runs/${id}/replay`)).replay.kind).toBe("MatchesRecordedPrefix");
    proof.transactionFailure = retained(row);
  } finally { await h.sql.query('DROP TRIGGER model2_fixture_write_failure ON "InternalModel2Run"; DROP FUNCTION model2_fixture_write_failure()'); }
  const barrier = await captureBarrier(h);
  try {
    const id = await create("cooperative-cancel"); await barrier.waiting();
    const cancellation = h.request(`/internal/model2/runs/${id}/cancel`, {}, "POST", 202);
    await until(async () => (await h.sql.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
      AND query LIKE 'UPDATE "InternalModel2Run" SET "cancelRequested"=%' AND wait_event_type='Lock'`)).rowCount ? true : undefined, "API cancellation transaction queued on the actual run row");
    await barrier.release(); await cancellation;
    const row = await until(async () => { const r = await read(id); return r.status === "cancelled" ? r : undefined; }, "cooperative internal cancellation");
    expect(row.sequence).toBeGreaterThanOrEqual(4); expect(row.sequence).toBeLessThanOrEqual(6);
    const report = (await h.request(`/internal/model2/runs/${id}/report`)).report;
    expect(report.unknown.join(" ")).toContain("retained prefix");
    await h.request(`/internal/model2/runs/${id}/cancel`, {}, "POST", 409);
    proof.cancellation = retained(row);
  } finally { await barrier.close(); }
  const revocation = await captureBarrier(h);
  try {
    const id = await create("authorization-revocation"); await revocation.waiting();
    await h.sql.query('DELETE FROM "InternalModel2Grant" WHERE "userId"=$1', [owner]);
    await h.request(`/internal/model2/runs/${id}/report`, undefined, "GET", 404);
    await revocation.release();
    const row = await until(async () => { const r = await read(id); return r.status === "cancelled" ? r : undefined; }, "revoked internal authorization stops execution");
    expect(row.sequence).toBeLessThanOrEqual(6);
    proof.authorizationRevocation = { ...retained(row), unauthorizedReport: 404 };
  } finally {
    await revocation.close();
    await h.sql.query('INSERT INTO "InternalModel2Grant" ("userId",reason) VALUES ($1,\'Restored disposable proof grant\') ON CONFLICT ("userId") DO NOTHING', [owner]);
  }
  return proof;
}
