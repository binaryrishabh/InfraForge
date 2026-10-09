import { Client } from "pg";
import { randomInt } from "node:crypto";

export async function verifyDatabaseTargets(migrationUrl: string, targets: string[]) {
  const primary = new Client({ connectionString: migrationUrl, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  const lock = [186542856, randomInt(1, 2147483647)];
  let locked = false;
  try {
    await primary.connect();
    const owner = await primary.query("SELECT pg_backend_pid() AS pid, pg_try_advisory_lock($1,$2) AS acquired", lock);
    locked = owner.rows[0].acquired;
    if (!locked) throw new Error("Database target probe could not acquire its private lock");
    for (const target of targets) {
      const client = new Client({ connectionString: target, connectionTimeoutMillis: 5000, query_timeout: 5000 });
      try {
        await client.connect();
        // Read only on possibly pooled API connections. No session locks are acquired there.
        const result = await client.query(`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=$3 AND locktype='advisory'
          AND classid=$1::oid AND objid=$2::oid AND objsubid=2 AND granted
          AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS same`, [...lock, owner.rows[0].pid]);
        if (!result.rows[0].same) throw new Error("API, worker and migration URLs do not reach the same PostgreSQL database");
      } finally { await client.end(); }
    }
  } finally {
    if (locked) await primary.query("SELECT pg_advisory_unlock($1,$2)", lock).catch(() => {});
    await primary.end();
  }
}
