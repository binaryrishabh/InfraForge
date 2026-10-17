import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { readLocalSettings } from "./localHarness";
import { WorkerOwnership } from "../../infra/workerOwnership";

// The simulator cycle, outbox poller and readiness probe call assertHeld() every
// second while lesson captures commit on the same session. A check issued during
// one of those transactions must not inherit its failure.
const integration = process.env.INTEGRATION_RUN === "1" ? test : test.skip;
integration("ownership checks never run inside another operation's transaction", async () => {
  const settings = readLocalSettings(process.env);
  const admin = new Pool({ connectionString: settings.databaseUrl, ssl: false, options: "" });
  // Advisory locks are per database, so a running worker elsewhere cannot interfere.
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`, url = new URL(settings.databaseUrl); url.pathname = "/" + name;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const blocked = async (release: (pid: number, observer: Client) => Promise<void>) => {
      const barrier = new Client({ connectionString: url.href }), observer = new Client({ connectionString: url.href });
      await barrier.connect(); await observer.connect();
      let lost = false;
      const ownership = await WorkerOwnership.acquire(url.href, () => { lost = true; });
      try {
        await barrier.query("SELECT pg_advisory_lock(186542854,3)");
        const write = ownership.transaction(async (db) => { await db.query("SELECT pg_advisory_xact_lock(186542854,3)"); return "committed"; })
          .then((value) => value, (error: Error) => error.message);
        let pid: number | undefined;
        for (let i = 0; i < 100 && !pid; i++) {
          await Bun.sleep(50);
          pid = (await observer.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=186542854::oid AND objid=3::oid AND NOT granted")).rows[0]?.pid;
        }
        expect(pid).toBeDefined();
        const check = ownership.assertHeld().then(() => "held", (error: Error) => error.message);
        await release(pid!, observer);
        await barrier.query("SELECT pg_advisory_unlock(186542854,3)");
        const result = { write: await write, check: await check, lost };
        const next = await ownership.transaction(async (db) => (await db.query("SELECT 1 AS ok")).rows[0].ok);
        return { ...result, next };
      } finally { await ownership.close().catch(() => {}); await barrier.end(); await observer.end(); }
    };
    // A failed capture statement rolls back; the queued check still runs on a clean session.
    const cancelled = await blocked(async (pid, observer) => { await Bun.sleep(200); await observer.query("SELECT pg_cancel_backend($1)", [pid]); });
    expect(cancelled).toEqual({ write: "canceling statement due to user request", check: "held", lost: false, next: 1 });
    // A check waiting behind a statement held past the 5s query timeout never started.
    const held = await blocked(async () => { await Bun.sleep(6000); });
    expect(held).toMatchObject({ check: "held", lost: false, next: 1 });
    expect(held.write).not.toBe("committed");
    // A terminated session is still reported as lost.
    let lost = false;
    const ownership = await WorkerOwnership.acquire(url.href, () => { lost = true; });
    const observer = new Client({ connectionString: url.href }); await observer.connect();
    try {
      const pid = (await observer.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=186542854::oid AND objid=1::oid AND granted")).rows[0].pid;
      await observer.query("SELECT pg_terminate_backend($1)", [pid]);
      await expect(ownership.assertHeld()).rejects.toThrow();
      expect(lost).toBe(true);
    } finally { await ownership.close().catch(() => {}); await observer.end(); }
  } finally {
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}, 30000);
