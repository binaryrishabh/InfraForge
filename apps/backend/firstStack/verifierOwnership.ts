import { Client } from "pg";

// Separate from the per-executor lock: held before recovery and until queue drain.
export const verifierLock = [186542854, 12];
export async function acquireVerifierOwnership(databaseUrl: string, onLost: () => void) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000,
    query_timeout: 5000, statement_timeout: 5000 });
  let held = false, closing = false;
  // The outbox poller, job worker and readiness probe share this lock session.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const lose = () => { if (!closing) { held = false; onLost(); } };
  client.on("error", lose); client.on("end", lose);
  try {
    await client.connect();
    held = (await client.query("SELECT pg_try_advisory_lock($1,$2) AS held", verifierLock)).rows[0]?.held === true;
    if (!held) throw Error("Another first-stack verifier owns this database");
  } catch (error) { closing = true; await client.end(); throw error; }
  return {
    get held() { return held; },
    assertHeld: () => serial(async () => {
      if (!held) throw Error("Verifier lifecycle ownership lost");
      try {
        const result = await client.query(`SELECT EXISTS (SELECT 1 FROM pg_locks
          WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=$1::oid
          AND objid=$2::oid AND objsubid=2 AND granted) AS held`, verifierLock);
        if (result.rows[0]?.held !== true) throw Error("Verifier lifecycle ownership lost");
      } catch (error) { lose(); throw error; }
    }),
    close: () => serial(async () => { closing = true; held = false; await client.end(); }),
  };
}
