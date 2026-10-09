import { Client } from "pg";
import { randomInt } from "node:crypto";

export function workerDatabaseUrl(env: Record<string, string | undefined>) {
  if (!env.DATABASE_URL) throw new Error("Worker requires DATABASE_URL");
  if (env.NODE_ENV === "production" && !["direct", "session"].includes(env.WORKER_DATABASE_MODE ?? "")) {
    throw new Error("Set WORKER_DATABASE_MODE=direct or session after verifying the provider endpoint; transaction pooling is unsupported");
  }
  const url = new URL(env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2 ||
    /-pooler\./i.test(url.hostname) || url.searchParams.get("pgbouncer") === "true" ||
    url.searchParams.get("pool_mode") === "transaction" || env.WORKER_DATABASE_MODE === "transaction") {
    throw new Error("Worker requires a PostgreSQL session-preserving endpoint; transaction pooling is unsupported");
  }
  return env.DATABASE_URL;
}

export async function verifyWorkerSession(databaseUrl: string) {
  const options = { connectionString: databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 5000 };
  const first = new Client(options);
  const second = new Client(options);
  const lock = [186542855, randomInt(1, 2147483647)];
  let firstLocked = false;
  let secondLocked = false;
  try {
    await first.connect();
    await second.connect();
    const one = await first.query("SELECT pg_backend_pid() AS pid, pg_try_advisory_lock($1,$2) AS acquired", lock);
    firstLocked = one.rows[0].acquired;
    const two = await second.query("SELECT pg_backend_pid() AS pid, pg_try_advisory_lock($1,$2) AS acquired", lock);
    secondLocked = two.rows[0].acquired;
    if (!firstLocked || secondLocked || one.rows[0].pid === two.rows[0].pid) {
      throw new Error("Connection does not preserve independent PostgreSQL sessions; transaction pooling is unsupported");
    }
    const stable = await first.query("SELECT pg_backend_pid() AS pid");
    if (stable.rows[0].pid !== one.rows[0].pid) throw new Error("PostgreSQL backend changed during a worker session");
  } finally {
    // Probe locks have their own namespace. Never unlock another worker's lock.
    if (secondLocked) await second.query("SELECT pg_advisory_unlock($1,$2)", lock).catch(() => {});
    if (firstLocked) await first.query("SELECT pg_advisory_unlock($1,$2)", lock).catch(() => {});
    await Promise.allSettled([first.end(), second.end()]);
  }
}
