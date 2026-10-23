import type { PoolClient } from "pg";

// Held in the same transaction as the immutable recovery receipt. A live
// verifier or executor refuses offline closure, even if a run is in recovery.
export async function requireOfflineRecovery(db: Pick<PoolClient, "query">) {
  for (const id of [12, 10]) {
    const row = (await db.query("SELECT pg_try_advisory_xact_lock(186542854,$1) AS held", [id])).rows[0];
    if (row?.held !== true) throw Error("Stop verifier and executor before operator recovery");
  }
}
