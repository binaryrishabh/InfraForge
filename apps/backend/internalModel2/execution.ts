import { assertExecutionHost } from "../executionIdentity/launch";
import { randomUUID } from "node:crypto";
import type { WorkerOwnership } from "../infra/workerOwnership";
import type { InternalRunRow } from "./store";
import { readEnvelope, captureCuts } from "./envelope";
import { capture, instantiate } from "./capture";
import type { StoredCapture, CaptureCheckpoint } from "./capture";
import { lessonRecord } from "./lessonStore";
import { executeLesson } from "./lessonExecution";
export async function retireInternalRuns(ownership: WorkerOwnership) {
  assertExecutionHost();
  await ownership.transaction(async (db) => {
    await db.query(`UPDATE "InternalModel2Run" SET status='interrupted',reason='Worker restarted; last durable prefix retained. Exact continuation is unsupported.',"updatedAt"=now() WHERE status='running'`);
    await db.query(`UPDATE "InternalModel2Run" r SET status='failed',reason='Durable queue delivery exhausted before execution',"updatedAt"=now()
      WHERE status='queued' AND EXISTS (SELECT 1 FROM "Outbox" o WHERE o."eventType"='model2-internal-created' AND o.status='failed' AND o.payload->>'internalModel2RunId'=r.id)`);
  });
}
export async function failInternalDelivery(ownership: WorkerOwnership, id: string) {
  assertExecutionHost();
  await ownership.transaction(async (db) => { await db.query(`UPDATE "InternalModel2Run" SET status='failed',reason='Durable queue delivery exhausted before execution',"updatedAt"=now() WHERE id=$1 AND status='queued'`, [id]); });
}
export async function executeInternalRun(id: string, ownership: WorkerOwnership) {
  assertExecutionHost();
  if (await lessonRecord(id)) { await executeLesson(id, ownership); return; }
  const claimed = await ownership.transaction(async (db) => {
    const row = (await db.query<InternalRunRow>('SELECT * FROM "InternalModel2Run" WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row || !["queued", "running"].includes(row.status)) return null;
    if (row.status === "running") { await db.query(`UPDATE "InternalModel2Run" SET status='interrupted',reason='Prior delivery stopped without a terminal commit; no resume',"updatedAt"=now() WHERE id=$1`, [id]); return null; }
    try {
      if (!(await db.query('SELECT 1 FROM "InternalModel2Grant" WHERE "userId"=$1 AND scope=\'operator\'', [row.ownerId])).rowCount) throw Error("Internal authorization revoked before execution");
      const input = readEnvelope(row.input, row.inputHash);
      if (input.runId !== row.id || input.ownerId !== row.ownerId) throw Error("Recorded execution owner/identity mismatch");
      const token = randomUUID();
      await db.query('UPDATE "InternalModel2Run" SET status=\'running\',token=$2,"updatedAt"=now() WHERE id=$1', [id, token]);
      return { input, token };
    } catch (error) {
      await db.query('UPDATE "InternalModel2Run" SET status=\'failed\',reason=$2,"updatedAt"=now() WHERE id=$1', [id, message(error)]); return null;
    }
  });
  if (!claimed) return;
  let sequence = 0;
  let history: CaptureCheckpoint[] = [];
  const stop = async (reason: string) => ownership.transaction(async (db) => {
    await db.query('UPDATE "InternalModel2Run" SET status=\'interrupted\',reason=$3,"updatedAt"=now() WHERE id=$1 AND token=$2 AND status=\'running\'', [id, claimed.token, reason.slice(0, 500)]);
  });
  async function persist(value: StoredCapture, final: boolean, failure: string | null) {
    return ownership.transaction(async (db) => {
      const row = (await db.query<InternalRunRow>('SELECT * FROM "InternalModel2Run" WHERE id=$1 AND token=$2 AND status=\'running\' FOR UPDATE', [id, claimed!.token])).rows[0];
      if (!row) return false;
      if (row.sequence !== sequence) throw Error("Durable capture sequence changed");
      const granted = (await db.query('SELECT 1 FROM "InternalModel2Grant" WHERE "userId"=$1 AND scope=\'operator\'', [row.ownerId])).rowCount;
      const cancelled = row.cancelRequested || !granted, status = cancelled ? "cancelled" : failure ? "failed" : final ? "completed" : "running";
      const reason = !granted ? "Internal authorization revoked; stopped at the next capture boundary" : row.cancelRequested ? "Cancellation requested; stopped at the next capture boundary" : failure;
      await db.query('UPDATE "InternalModel2Run" SET status=$3,evidence=$4,sequence=$5,"throughUs"=$6,reason=$7,"updatedAt"=now() WHERE id=$1 AND token=$2 AND status=\'running\'', [id, claimed!.token, status, value, value.sequence, value.throughUs, reason]);
      sequence = value.sequence; return status === "running";
    });
  }
  try {
    const runtime = instantiate(claimed.input), cuts = captureCuts(claimed.input);
    for (const at of cuts) {
      await ownership.assertHeld();
      let failure: string | null = null;
      try { runtime.advanceTo(at); } catch (error) { failure = message(error); }
      const value = capture(runtime, claimed.input, sequence + 1, history);
      if (!await persist(value, at === runtime.horizon, failure)) return;
      history = value.checkpoints;
    }
  } catch (error) {
    // Advanced work whose capture did not commit is never replayed as continuation.
    // If this write also fails, startup/re-delivery will retire the running row.
    await stop(`Execution/persistence interrupted: ${message(error)}; last durable prefix retained`);
  }
}
const message = (error: unknown) => (error instanceof Error ? error.message : "Internal execution failed").slice(0, 400);
