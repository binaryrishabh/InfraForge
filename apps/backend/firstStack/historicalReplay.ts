import type { Pool } from "pg";
import { NotFoundError } from "../utils/errors";
import { hash } from "./canonical";
import { firstStackReport, type FirstStackStoredReportRow } from "./report";
import { inputDigest, readIsolatedCut, type IsolatedCut } from "./isolationProtocol";
import { assertQualified } from "./isolationPolicy";
import { replayFirstStackIsolated } from "./isolatedExecution";
import { withFirstStackOwnership } from "./isolationOwnership";
import type { SubmissionVerifier } from "./submissionWorker";
import { submissionTransaction } from "./admission";
import { z } from "zod";

export interface HistoricalReplayRow extends FirstStackStoredReportRow {
  ownerId: string; authorized: boolean; engine: { source: string; image: string };
}

// Offline only: stop the previous owner and review its exact labelled container
// before releasing recovery capacity. This never retries uncertain execution.
export async function closeHistoricalReplayRecovery(pool: Pool, id: string, value: unknown) {
  const review = z.object({ token: z.uuid(), daemon: z.string().regex(/^[a-f0-9]{64}$/), cleanup: z.enum(["removed", "not-created"]),
    reviewer: z.string().trim().min(1).max(256), proof: z.string().trim().min(1).max(500) }).strict().parse(value);
  await submissionTransaction(pool, async db => {
    const row = (await db.query('SELECT * FROM "FirstStackReplay" WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row || row.status !== "recovery" || row.id !== review.token || row.daemon !== review.daemon) throw Error("Historical replay recovery identity differs");
    await db.query('UPDATE "FirstStackReplay" SET status=\'terminal\',result=$2 WHERE id=$1', [id,
      { kind: "Unavailable", reason: "Operator reviewed cleanup; historical replay was interrupted", recovery: review }]);
  });
}
export async function ownedReplayRow(pool: Pick<Pool, "query">, owner: string, id: string): Promise<HistoricalReplayRow> {
  const row = (await pool.query(`SELECT r.*,w.status,w.authorized,s.body AS result,s.hash AS "resultHash",
    (SELECT body FROM "FirstStackCut" WHERE "runId"=r.id ORDER BY sequence DESC LIMIT 1) AS "durablePrefix"
    FROM "FirstStackRun" r JOIN "FirstStackWork" w ON w."runId"=r.id
    LEFT JOIN "FirstStackResult" s ON s."runId"=r.id WHERE r.id=$1 AND r."ownerId"=$2`, [id, owner])).rows[0];
  if (!row || row.ownerId !== owner) throw new NotFoundError();
  return row;
}
// No compiler, registry, latest design, tariff or challenge definition is read.
// Old reports remain readable even when their exact executor is unavailable.
export function historicalReplayTarget(row: HistoricalReplayRow, configuration: SubmissionVerifier): IsolatedCut {
  if (row.status !== "terminal" || !row.authorized) throw Error("Historical replay requires a terminal authorized run");
  if (row.engine.source !== configuration.isolation.source || row.engine.image !== configuration.isolation.image) throw Error("Pinned historical executor unavailable; no latest-input replay");
  assertQualified(configuration.isolation.qualification, { ...configuration.isolation, daemon: configuration.control.identity });
  if (inputDigest(row.input) !== row.inputHash) throw Error("Historical input hash mismatch");
  // Browser-only observations are never treated as a durable server prefix.
  const cut = readIsolatedCut(row.durablePrefix as IsolatedCut, row.engine.source, row.inputHash);
  if (hash(cut.cut.lock) !== hash(row.lock) || firstStackReport(row).origin !== "server") throw Error("Historical capture or compile lock unavailable/corrupt");
  return cut;
}
export async function replayHistoricalSubmission(pool: Pool, databaseUrl: string, replayId: string,
  configuration: SubmissionVerifier, enabled: () => boolean, cancelled: () => Promise<boolean>) {
  const reservation = await submissionTransaction(pool, async db => {
    const replay = (await db.query('SELECT * FROM "FirstStackReplay" WHERE id=$1 FOR UPDATE', [replayId])).rows[0];
    if (!replay || replay.status !== "queued") return null;
    try {
      if (!enabled() || replay.cancelled) throw Error("Historical replay cancelled or disabled");
      const row = await ownedReplayRow(db, replay.ownerId, replay.runId);
      if (historicalReplayTarget(row, configuration).fingerprint !== replay.fingerprint) throw Error("Requested historical prefix changed");
    } catch (error) {
      await db.query('UPDATE "FirstStackReplay" SET status=\'terminal\',result=$2 WHERE id=$1', [replayId,
        { kind: "Unavailable", reason: error instanceof Error ? error.message : "Historical replay unavailable" }]);
      return null;
    }
    await db.query('UPDATE "FirstStackReplay" SET status=\'running\',daemon=$2 WHERE id=$1', [replayId, configuration.control.identity]);
    return replay;
  });
  if (!reservation) return;
  const { ownerId: owner, runId: id, fingerprint } = reservation;
  // Same PostgreSQL session lock and fixed daemon container as execution.
  // No new Run/Cut/Result is written and no terminal verification is relabelled.
  try {
    const row = await ownedReplayRow(pool, owner, id), expected = historicalReplayTarget(row, configuration);
    const result = await withFirstStackOwnership(databaseUrl, {
      token: replayId,
      async check(db) {
        if (!enabled() || await cancelled()) throw Error("Historical replay cancelled or disabled");
        const state = (await db.query('SELECT * FROM "FirstStackReplay" WHERE id=$1', [replayId])).rows[0];
        if (!state || state.status !== "running" || state.cancelled || state.daemon !== configuration.control.identity) throw Error("Historical replay ownership lost");
        const current = await ownedReplayRow(db, owner, id);
        if (historicalReplayTarget(current, configuration).fingerprint !== fingerprint || current.inputHash !== row.inputHash || hash(current.lock) !== hash(row.lock)) throw Error("Historical replay identity changed");
      },
      async commit() { throw Error("Historical replay cannot write execution evidence"); },
    }, (authority, signal) => replayFirstStackIsolated(configuration.control, configuration.isolation, row.input, expected, authority, signal));
    await submissionTransaction(pool, async db => {
      const state = (await db.query('SELECT * FROM "FirstStackReplay" WHERE id=$1 FOR UPDATE', [replayId])).rows[0];
      if (!state || state.status !== "running" || state.daemon !== configuration.control.identity) throw Error("Historical replay completion fence lost");
      if (!["removed", "not-created"].includes(result.receipt.cleanup)) {
        await db.query('UPDATE "FirstStackReplay" SET status=\'recovery\' WHERE id=$1', [replayId]); return;
      }
      const current = await ownedReplayRow(db, owner, id);
      let compatible = false;
      try { compatible = historicalReplayTarget(current, configuration).fingerprint === fingerprint; } catch { /* Report remains readable. */ }
      const body = enabled() && !state.cancelled && compatible && result.status === "completed" && result.receipt.cleanup === "removed" && result.replay ?
        { ...result.replay, receipt: result.receipt } : { kind: "Unavailable", reason: result.interruption?.reason ?? "Historical replay cancelled, disabled or unavailable", receipt: result.receipt };
      await db.query('UPDATE "FirstStackReplay" SET status=\'terminal\',result=$2 WHERE id=$1', [replayId, body]);
    });
  } catch (error) {
    await submissionTransaction(pool, async db => { await db.query('UPDATE "FirstStackReplay" SET status=\'recovery\' WHERE id=$1 AND status=\'running\'', [replayId]); });
    throw error;
  }
}
