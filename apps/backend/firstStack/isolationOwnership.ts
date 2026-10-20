import { Client } from "pg";
import type { IsolatedCut } from "./isolationProtocol";
import type { IsolationAuthority } from "./isolationRunner";

// Session locks do not expire and are not persisted runner leases. The fixed
// daemon container name separately fences an orphan after its DB session dies.
const lock = [186542854, 10];
export async function withFirstStackOwnership<T>(databaseUrl: string,
  store: { check(db: Client): Promise<void>; commit(db: Client, cut: IsolatedCut): Promise<void> },
  task: (authority: IsolationAuthority, signal: AbortSignal) => Promise<T>) {
  const db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000, lock_timeout: 1000 });
  const lost = new AbortController();
  let held = false, closing = false, queue: Promise<unknown> = Promise.resolve();
  const lose = () => { held = false; lost.abort(Error("First-stack database ownership lost")); };
  db.on("error", lose); db.on("end", () => { if (!closing) lose(); });
  const serial = <R>(operation: () => Promise<R>) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const check = async (signal: AbortSignal) => {
    signal.throwIfAborted(); lost.signal.throwIfAborted();
    if (!held) throw Error("First-stack executor ownership unavailable");
    const r = await db.query("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=$1::oid AND objid=$2::oid AND objsubid=2 AND granted) AS held", lock);
    if (r.rows[0]?.held !== true) { lose(); throw Error("First-stack executor fence lost"); }
    await store.check(db); signal.throwIfAborted(); lost.signal.throwIfAborted();
  };
  try {
    await db.connect();
    held = (await db.query("SELECT pg_try_advisory_lock($1,$2) AS held", lock)).rows[0]?.held === true;
    if (!held) throw Error("First-stack execute/replay capacity busy");
    return await task({
      assertHeld: signal => serial(() => check(signal)),
      commit: (cut, signal) => serial(async () => {
        await check(signal);
        await db.query("BEGIN");
        try {
          await store.check(db); await store.commit(db, cut); await check(signal);
          await db.query("COMMIT");
        } catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
      }),
    }, lost.signal);
  } finally {
    closing = true; lost.abort(Error("First-stack ownership closed"));
    // Closing the session also rolls back any uncertain transaction. The caller
    // must read its store after a lost commit response, never rerun automatically.
    await db.end().catch(() => {});
  }
}
