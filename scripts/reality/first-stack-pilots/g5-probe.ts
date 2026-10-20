import { appendFileSync, writeFileSync } from "node:fs";
import { environment, telemetry } from "./telemetry";

const host = process.argv[2]!, mode = process.argv[3] ?? "baseline", out = `/out/${mode}.jsonl`;
const emit = (row: object) => appendFileSync(out, JSON.stringify({ atUs: performance.now() * 1000, ...row }) + "\n");
const clients: Bun.SQL[] = [];
const connect = (role = "pilot_app", port = 5432) => {
  const sql = new Bun.SQL(`postgres://${role}@${host}:${port}/pilot`, { max: 1, idleTimeout: 0, connectionTimeout: 2 }); clients.push(sql); return sql;
};
let admin = connect("postgres");
async function query(id: string, sql: Bun.SQL, text: string) {
  const startUs = performance.now() * 1000;
  try { const rows = await sql.unsafe(text); emit({ id, text, startUs, outcome: "completed", rows }); return { ok: true, rows, code: null }; }
  catch (error) { const e = error as Bun.SQL.PostgresError; emit({ id, text, startUs, outcome: "error", code: e.errno ?? e.code, message: e.message }); return { ok: false, rows: null, code: e.errno ?? e.code }; }
}
const close = async (sql: Bun.SQL) => { await sql.close({ timeout: 0 }); };
emit({ kind: "environment", mode, environment: environment(), telemetry: telemetry() });
try {
  if (mode === "baseline") {
    await query("settings", admin, "SELECT name,setting,unit FROM pg_settings WHERE name IN ('server_version','max_connections','reserved_connections','superuser_reserved_connections','statement_timeout','lock_timeout','transaction_timeout','fsync','synchronous_commit') ORDER BY name");
    // Close the monitor while filling all five non-reserved slots. Reconnect
    // through a reserved superuser slot to observe the idle population.
    await close(admin);
    const idle: Bun.SQL[] = [];
    for (let i = 0; i < 7; i++) { const c = connect(); idle.push(c); await query(`idle-${i}`, c, "SELECT pg_backend_pid() AS pid"); }
    admin = connect("postgres");
    await query("reserved-monitor", admin, "SELECT usename,state,count(*)::int FROM pg_stat_activity WHERE datname='pilot' GROUP BY usename,state ORDER BY usename,state");
    await close(admin); await close(idle[0]!); await query("slot-replacement", connect(), "SELECT 1 AS value");
    for (const c of clients.slice(1)) await close(c);
    admin = connect("postgres");
    for (let repeat = 0; repeat < 3; repeat++) {
      const c = connect(); await query(`statement-set-${repeat}`, c, "SET statement_timeout='80ms'");
      await query(`statement-timeout-${repeat}`, c, "SELECT pg_sleep(0.3)");
      await query(`post-statement-session-${repeat}`, c, "SELECT 1 AS value"); await close(c);
      const t = connect(); await query(`transaction-set-${repeat}`, t, "SET transaction_timeout='80ms'");
      await query(`transaction-timeout-${repeat}`, t, "SELECT pg_sleep(0.3)"); await close(t);
      const holder = connect(), waiter = connect();
      await query(`begin-${repeat}`, holder, "BEGIN"); await query(`lock-holder-${repeat}`, holder, "UPDATE pilot_keys SET value=value+1 WHERE id=1");
      await query(`lock-set-${repeat}`, waiter, "SET lock_timeout='80ms'");
      await query(`lock-timeout-${repeat}`, waiter, "UPDATE pilot_keys SET value=value+1 WHERE id=1");
      await close(holder); await query(`lock-released-${repeat}`, waiter, "UPDATE pilot_keys SET value=value+1 WHERE id=1 RETURNING value"); await close(waiter);
      const cancel = connect(); const pid = (await cancel`SELECT pg_backend_pid() AS pid`)[0].pid;
      const running = query(`cancel-query-${repeat}`, cancel, "SELECT pg_sleep(0.3)"); await Bun.sleep(60);
      await query(`cancel-ack-${repeat}`, admin, `SELECT pg_cancel_backend(${Number(pid)}) AS acknowledged`); await running;
      await query(`post-cancel-session-${repeat}`, cancel, "SELECT 1 AS value"); await close(cancel);
      // Caller stops observing before an uncancelled autocommit finishes.
      const late = connect(); const remote = query(`remote-write-${repeat}`, late, `INSERT INTO pilot_commits SELECT ${repeat}, 1 FROM pg_sleep(0.15) RETURNING id`);
      await Bun.sleep(30); emit({ id: `caller-deadline-${repeat}`, outcome: "deadline-exceeded", remoteCancellation: "detach", transactionId: repeat });
      await remote; await query(`reconcile-${repeat}`, admin, `SELECT id,value FROM pilot_commits WHERE id=${repeat}`); await close(late);
    }
    // Synchronous standby wait gives an observable commit interval. It is a
    // controlled intervention, not a local disk-latency or durability estimate.
    await query("sync-standby-set", admin, "ALTER SYSTEM SET synchronous_standby_names='*'");
    await query("sync-standby-reload", admin, "SELECT pg_reload_conf()"); await Bun.sleep(100);
    const commit = connect(); await query("sync-commit-set", commit, "SET synchronous_commit=on");
    const pid = (await commit`SELECT pg_backend_pid() AS pid`)[0].pid;
    const running = query("commit-cancel-write", commit, "INSERT INTO pilot_commits VALUES(99,1) RETURNING id");
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const rows = await admin`SELECT wait_event FROM pg_stat_activity WHERE pid=${pid}`;
      if (rows[0]?.wait_event === "SyncRep") { waiting = true; break; } await Bun.sleep(10);
    }
    emit({ id: "commit-wait-observed", waiting });
    if (waiting) await query("commit-cancel-ack", admin, `SELECT pg_cancel_backend(${Number(pid)}) AS acknowledged`);
    else await query("commit-unblock", admin, "ALTER SYSTEM SET synchronous_standby_names=''");
    if (!waiting) await query("commit-reload", admin, "SELECT pg_reload_conf()");
    await running; await close(commit);
    await query("commit-cancel-reconcile", admin, "SELECT id,value FROM pilot_commits WHERE id=99");
  } else if (mode === "pooler") {
    const a = connect("pilot_app", 6432), b = connect("pilot_app", 6432);
    await query("pool-begin", a, "BEGIN"); const first = await query("pool-owner", a, "SELECT pg_backend_pid() AS pid");
    const pending = query("pool-waiter", b, "SELECT pg_backend_pid() AS pid"); await Bun.sleep(120);
    await query("pool-activity", admin, "SELECT usename,state,count(*)::int FROM pg_stat_activity WHERE datname='pilot' GROUP BY usename,state ORDER BY usename,state");
    await query("pool-commit", a, "COMMIT"); const second = await pending;
    emit({ id: "pool-reused-backend", sameBackend: first.rows?.[0]?.pid === second.rows?.[0]?.pid, supported: false });
  } else {
    const c = connect(); await query("shutdown-begin", c, "BEGIN"); await query("shutdown-write", c, "UPDATE pilot_keys SET value=value+1 WHERE id=1");
    const running = query("shutdown-query", c, "SELECT pg_sleep(5)");
    writeFileSync(`/out/${mode}.ready`, "ready\n");
    await running;
    if (mode === "smart") { await query("shutdown-commit", c, "COMMIT"); await close(c); }
  }
} finally {
  for (const c of clients) { try { await close(c); } catch {} }
  emit({ kind: "end", telemetry: telemetry() });
}
