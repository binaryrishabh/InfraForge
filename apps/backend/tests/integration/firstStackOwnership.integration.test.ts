import { expect, test } from "bun:test";
import { Pool } from "pg";
import { withFirstStackOwnership } from "../../firstStack/isolationOwnership";
import type { IsolatedCut } from "../../firstStack/isolationProtocol";

const url = process.env.FIRST_STACK_TEST_DATABASE;
const local = () => {
  const parsed = new URL(url!);
  if (process.env.INTEGRATION_DISPOSABLE !== "local-only" || !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/infraforge_isolation" || parsed.search) throw Error("Explicit disposable local isolation database required");
  return url!;
};
(url ? test : test.skip)("first-stack session fence excludes overlap, retains committed cuts on DB death and rolls back revocation", async () => {
  const connection = local(), pool = new Pool({ connectionString: connection, max: 2, query_timeout: 3000 });
  const cut = { cut: { sequence: 1 }, fingerprint: "fixture" } as IsolatedCut;
  let allowed = true, pid = 0;
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS first_stack_ownership_probe (id integer primary key, sequence integer NOT NULL)");
    await pool.query("TRUNCATE first_stack_ownership_probe");
    const store = { check: async () => { if (!allowed) throw Error("revoked"); },
      commit: async (db: any, value: IsolatedCut) => { await db.query("INSERT INTO first_stack_ownership_probe VALUES (1,$1) ON CONFLICT(id) DO UPDATE SET sequence=$1", [value.cut.sequence]); } };
    await withFirstStackOwnership(connection, store, async (authority, signal) => {
      await expect(withFirstStackOwnership(connection, store, async () => {})).rejects.toThrow("capacity busy");
      await authority.commit(cut, signal);
      expect((await pool.query("SELECT sequence FROM first_stack_ownership_probe")).rows[0].sequence).toBe(1);
      pid = (await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=186542854 AND objid=10 AND granted")).rows[0].pid;
      await pool.query("SELECT pg_terminate_backend($1)", [pid]);
      await expect(authority.assertHeld(signal)).rejects.toThrow();
    });
    expect((await pool.query("SELECT sequence FROM first_stack_ownership_probe")).rows[0].sequence).toBe(1);
    await withFirstStackOwnership(connection, { ...store, commit: async (db, value) => { await store.commit(db, value); allowed = false; } }, async (authority, signal) => {
      await expect(authority.commit({ ...cut, cut: { ...cut.cut, sequence: 2 } }, signal)).rejects.toThrow("revoked");
    });
    expect((await pool.query("SELECT sequence FROM first_stack_ownership_probe")).rows[0].sequence).toBe(1);
    allowed = true;
    await withFirstStackOwnership(connection, store, async (authority, signal) => { await authority.assertHeld(signal); });
    expect(pid).toBeGreaterThan(0);
  } finally { await pool.query("DROP TABLE IF EXISTS first_stack_ownership_probe"); await pool.end(); }
}, 30000);
