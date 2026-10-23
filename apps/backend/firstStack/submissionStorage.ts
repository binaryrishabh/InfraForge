import type { Pool, PoolClient } from "pg";

export const submissionStorageLimits = Object.freeze({ liveBytes: 2 * 1024 ** 3, historyBytes: 2 * 1024 ** 3 });

export async function submissionStorage(db: Pick<Pool | PoolClient, "query">) {
  const row = (await db.query(`SELECT
    COALESCE((SELECT sum("reservedBytes") FROM "FirstStackRun"),0)::text AS recorded,
    (COALESCE((SELECT sum(r."reservedBytes") FROM "FirstStackRun" r JOIN "FirstStackWork" w ON w."runId"=r.id WHERE w.status<>'terminal'),0)
      + (SELECT count(*)*32768 FROM "FirstStackReplay" WHERE status<>'terminal'))::text AS live,
    COALESCE((SELECT sum(octet_length(to_jsonb(r)::text)) FROM "FirstStackRun" r),0)::text AS runs,
    COALESCE((SELECT sum(octet_length(body::text)) FROM "FirstStackCut"),0)::text AS cuts,
    COALESCE((SELECT sum(octet_length(body::text)) FROM "FirstStackResult"),0)::text AS results,
    COALESCE((SELECT sum(octet_length(to_jsonb(r)::text)) FROM "FirstStackReplay" r),0)::text AS replays,
    (SELECT sum(pg_total_relation_size(c.oid))::text FROM pg_class c WHERE c.relnamespace='public'::regnamespace
      AND c.relname IN ('FirstStackRun','FirstStackWork','FirstStackCut','FirstStackResult','FirstStackOutbox','FirstStackReplay','FirstStackQueueEvent')) AS physical`)).rows[0];
  if (!row || [row.recorded, row.live, row.runs, row.cuts, row.results, row.replays, row.physical].some(v => v === null || !/^\d+$/.test(String(v)))) {
    throw Error("Submission storage usage unavailable");
  }
  const recordedReservationBytes = Number(row.recorded), liveReservedBytes = Number(row.live), runBytes = Number(row.runs), cutBytes = Number(row.cuts),
    resultBytes = Number(row.results), replayBytes = Number(row.replays), physicalBytes = Number(row.physical);
  const historyBytes = runBytes + cutBytes + resultBytes + replayBytes;
  if (![recordedReservationBytes, liveReservedBytes, historyBytes, physicalBytes].every(Number.isSafeInteger)) throw Error("Submission storage usage unavailable");
  // Full JSON text includes repeated serial cuts and every hidden scored audit.
  // Physical includes indexes/TOAST; the admission charge is conservative and
  // additionally reserves future evidence for every outstanding execution.
  const chargedBytes = Math.max(historyBytes, physicalBytes) + liveReservedBytes;
  return { recordedReservationBytes, liveReservedBytes, runBytes, cutBytes, resultBytes, replayBytes, historyBytes, physicalBytes, chargedBytes,
    warning: chargedBytes >= submissionStorageLimits.historyBytes * 0.8 };
}

export function requireSubmissionStorage(usage: Awaited<ReturnType<typeof submissionStorage>>, nextBytes: number, verifying: boolean) {
  return (!verifying || usage.liveReservedBytes + nextBytes <= submissionStorageLimits.liveBytes) &&
    usage.chargedBytes + nextBytes <= submissionStorageLimits.historyBytes;
}
