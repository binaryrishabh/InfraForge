import { expect, test } from "bun:test";
import { databaseUrl, readOnly, safeFailure, CutoverError } from "../cutover/database";
import { retirementRequest, retireLegacyRuns, FENCE_ACK } from "../cutover/retire";
import { migrationManifest } from "../release/migrations";
import { catalogDifferences } from "../cutover/catalog";

test("operator targets require explicit URLs and verified remote TLS; retirement requires fencing", () => {
  for (const url of [undefined, "https://example.invalid/db", "postgresql://user:secret@remote.invalid/db"]) expect(() => databaseUrl(url)).toThrow();
  expect(() => databaseUrl("postgresql://user:secret@ep-fixture-pooler.us-east-2.aws.neon.tech/db?sslmode=verify-full", true)).toThrow("direct");
  expect(() => databaseUrl("postgresql://user:secret@remote.invalid/db?sslmode=verify-full&sslmode=disable")).toThrow("Duplicate");
  expect(() => retirementRequest([crypto.randomUUID()], undefined, "fixture")).toThrow("fenced");
  expect(() => retirementRequest([], FENCE_ACK, "fixture")).toThrow("explicit");
  const id = crypto.randomUUID();
  expect(() => retirementRequest([id, id], FENCE_ACK, "fixture")).toThrow();
  expect(() => retirementRequest([id], FENCE_ACK, "person@example.invalid")).toThrow();
});

test("read-only evidence transactions never issue mutation statements, even on failure", async () => {
  const statements: string[] = [];
  const db = { query: async (sql: string) => { statements.push(sql); return { rows: [] }; } } as any;
  await expect(readOnly(db, async () => { await db.query("SELECT version()"); throw new Error("fixture"); })).rejects.toThrow();
  expect(statements).toEqual(["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "SET LOCAL statement_timeout = '30s'",
    "SET LOCAL search_path = pg_catalog, public", "SET LOCAL TIME ZONE 'UTC'", "SET LOCAL DateStyle = 'ISO, YMD'", "SELECT version()", "ROLLBACK"]);
});

test("catalog comparison detects extra, missing and altered objects without exposing definitions", () => {
  expect(catalogDifferences({ "function:guard()": "one", "index:old": "x" }, { "function:guard()": "two", "column:new": "y" }))
    .toEqual([{ object: "column:new", change: "unexpected" }, { object: "function:guard()", change: "definition differs" }, { object: "index:old", change: "missing" }]);
  expect(safeFailure(new Error("password=secret token=secret"))).not.toContain("secret");
  expect(safeFailure(new CutoverError("Fencing required"))).toBe("Fencing required");
});

test("retirement locks the deterministic table set before any snapshot query", async () => {
  const statements: string[] = [];
  const ids = [crypto.randomUUID()];
  const history = (await migrationManifest()).slice(0, 8).map((item) => ({
    migration_name: item.name, checksum: item.checksum, finished_at: new Date(), rolled_back_at: null,
  }));
  const db = { query: async (sql: string) => {
    statements.push(sql.replace(/\s+/g, " ").trim());
    if (sql.includes("server_version_num")) return { rows: [{ version: 180006 }] };
    if (sql.includes("to_regclass")) return { rows: [{ present: true }] };
    if (sql.includes("SELECT migration_name")) return { rows: history };
    if (sql.includes("pg_locks")) return { rows: [{ held: false }] };
    if (sql.includes("count(*)")) return { rows: [{ count: 0 }] };
    if (sql.startsWith("UPDATE")) return { rows: ids.map((id) => ({ id })), rowCount: ids.length };
    if (sql.includes("FOR UPDATE")) return { rows: ids.map((id) => ({ id, status: "live", timelineType: "array" })) };
    return { rows: [] };
  } } as any;
  expect((await retireLegacyRuns(db, retirementRequest(ids, FENCE_ACK, "fixture"))).count).toBe(1);
  expect(statements[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
  const lock = statements.findIndex((sql) => /^LOCK TABLE\b/.test(sql));
  expect(lock).toBeGreaterThan(1);
  const setup = statements.slice(1, lock);
  expect(setup.every((sql) => /^SET LOCAL (?:lock_timeout|statement_timeout|search_path)\s*=\s*(?:'[^']*'|[a-z_, ]+)$/i.test(sql)
    || /^SET LOCAL TIME ZONE 'UTC'$/i.test(sql))).toBe(true);
  expect(setup).toContain("SET LOCAL TIME ZONE 'UTC'");
  expect(statements[lock]).toBe('LOCK TABLE public."Infrastructure", public."Deployment", public."Outbox" IN SHARE ROW EXCLUSIVE MODE NOWAIT');
  for (const check of ["server_version_num", "to_regclass", "SELECT migration_name", "pg_locks", "pg_stat_activity", 'public."Outbox" WHERE', "FOR UPDATE"]) {
    expect(statements.findIndex((sql) => sql.includes(check))).toBeGreaterThan(lock);
  }
  expect(statements.findIndex((sql) => /^UPDATE\b/.test(sql))).toBeGreaterThan(lock);
  expect(statements.at(-1)).toBe("COMMIT");
});
