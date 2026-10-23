import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Queue } from "bullmq";
import { submissionTransaction } from "./admission";

export const verificationJobOptions = Object.freeze({ attempts: 1,
  removeOnComplete: { age: 86400, count: 128 }, removeOnFail: { age: 30 * 86400, count: 256 } });

export async function pruneVerificationJobs(queue: Pick<Queue, "clean" | "getJobs">) {
  for (const state of ["completed", "failed"] as const) {
    const policy = state === "completed" ? verificationJobOptions.removeOnComplete : verificationJobOptions.removeOnFail;
    // Also converges legacy jobs created with removeOnComplete/removeOnFail=false.
    await queue.clean(policy.age * 1000, 256, state);
    const excess = await queue.getJobs([state], policy.count, policy.count + 255, false);
    for (const job of excess) await job.remove();
  }
}

export async function recordQueueEvent(pool: Pool, kind: "failed" | "stalled" | "reconciled") {
  await pool.query('INSERT INTO "FirstStackQueueEvent" (kind) VALUES ($1)', [kind]);
}

// Only delivery is repeatable. A missing/terminal Redis job is never evidence
// that execution was safe to repeat. Capture a recovery token without launching.
export async function reconcileSubmissionQueue(pool: Pool, queue: Pick<Queue, "getJob">, daemon: string) {
  const candidates = await pool.query(`SELECT w."runId" AS id, 'submission' AS operation
    FROM "FirstStackWork" w JOIN "FirstStackOutbox" o ON o."runId"=w."runId"
    WHERE w.status='queued' AND o.delivered
    UNION ALL SELECT id, 'replay' FROM "FirstStackReplay" WHERE status='queued' AND delivered`);
  for (const row of candidates.rows) {
    const job = await queue.getJob(row.operation === "replay" ? `replay-${row.id}` : row.id);
    const state = job ? await job.getState() : "unknown";
    if (!["unknown", "failed", "completed"].includes(state)) continue;
    await submissionTransaction(pool, async db => {
      // The same transaction lock as the worker makes the claim race harmless.
      // Both transitions use the original SQL guards; no recovery bypass exists.
      const claimed = row.operation === "submission" ? await db.query(`UPDATE "FirstStackWork"
        SET status='running',token=$2,daemon=$3 WHERE "runId"=$1 AND status='queued' RETURNING "runId"`,
      [row.id, randomUUID(), daemon]) : await db.query(`UPDATE "FirstStackReplay"
        SET status='running',daemon=$2 WHERE id=$1 AND status='queued' RETURNING id`, [row.id, daemon]);
      if (!claimed.rowCount) return;
      if (row.operation === "submission") await db.query('UPDATE "FirstStackWork" SET status=\'recovery\' WHERE "runId"=$1', [row.id]);
      else await db.query('UPDATE "FirstStackReplay" SET status=\'recovery\' WHERE id=$1', [row.id]);
      await db.query('INSERT INTO "FirstStackQueueEvent" (kind) VALUES (\'reconciled\')');
    });
  }
  // Pure operational event receipts, never run inputs, cuts, results or reviews.
  await pool.query('DELETE FROM "FirstStackQueueEvent" WHERE "createdAt" < CURRENT_TIMESTAMP - INTERVAL \'30 days\'');
}

export async function queueOperations(pool: Pool, queue: Pick<Queue, "getJobCounts">) {
  const counts = await queue.getJobCounts("waiting", "active", "failed", "completed", "delayed");
  const summary = (await pool.query(`SELECT
    (SELECT count(*)::int FROM "FirstStackWork" WHERE status='recovery') +
    (SELECT count(*)::int FROM "FirstStackReplay" WHERE status='recovery') AS recovery,
    (SELECT extract(epoch FROM CURRENT_TIMESTAMP-min("createdAt"))*1000 FROM (
      SELECT r."createdAt" FROM "FirstStackRun" r JOIN "FirstStackWork" w ON w."runId"=r.id WHERE w.status='queued'
      UNION ALL SELECT "createdAt" FROM "FirstStackReplay" WHERE status='queued') q) AS "oldestQueuedMs",
    (SELECT extract(epoch FROM CURRENT_TIMESTAMP-min("createdAt"))*1000 FROM (
      SELECT "createdAt" FROM "FirstStackOutbox" WHERE NOT delivered
      UNION ALL SELECT "createdAt" FROM "FirstStackReplay" WHERE NOT delivered AND status='queued') q) AS "deliveryLagMs",
    (SELECT max(extract(epoch FROM ("deliveredAt"-"createdAt"))*1000) FROM (
      SELECT "createdAt","deliveredAt" FROM "FirstStackOutbox" WHERE "deliveredAt">=CURRENT_TIMESTAMP-INTERVAL '30 days'
      UNION ALL SELECT "createdAt","deliveredAt" FROM "FirstStackReplay" WHERE "deliveredAt">=CURRENT_TIMESTAMP-INTERVAL '30 days') q) AS "maxDeliveryLag30dMs",
    count(*) FILTER (WHERE kind='failed')::int AS "failed30d",
    count(*) FILTER (WHERE kind='stalled')::int AS "stalled30d",
    count(*) FILTER (WHERE kind='reconciled')::int AS "reconciled30d"
    FROM "FirstStackQueueEvent" WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days'`)).rows[0];
  if (!summary || [counts.waiting, counts.active, counts.failed, counts.completed, counts.delayed,
    summary.recovery, summary.failed30d, summary.stalled30d, summary.reconciled30d]
    .some(v => !Number.isSafeInteger(v) || v < 0) ||
    [summary.oldestQueuedMs, summary.deliveryLagMs, summary.maxDeliveryLag30dMs]
      .some(v => v !== null && (!Number.isFinite(Number(v)) || Number(v) < 0))) throw Error("Queue metrics unavailable");
  // Explicit numeric allowlist. Never return job payloads, error text or hidden audit.
  return { redis: { waiting: counts.waiting, active: counts.active, failed: counts.failed,
    completed: counts.completed, delayed: counts.delayed }, recovery: summary.recovery,
  oldestQueuedMs: summary.oldestQueuedMs === null ? null : Number(summary.oldestQueuedMs),
  deliveryLagMs: summary.deliveryLagMs === null ? null : Number(summary.deliveryLagMs),
  maxDeliveryLag30dMs: summary.maxDeliveryLag30dMs === null ? null : Number(summary.maxDeliveryLag30dMs),
  failed30d: summary.failed30d, stalled30d: summary.stalled30d, reconciled30d: summary.reconciled30d };
}
