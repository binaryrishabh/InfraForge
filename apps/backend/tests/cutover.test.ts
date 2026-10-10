import { expect, test } from "bun:test";
import { databaseUrl, readOnly, safeFailure, CutoverError } from "../cutover/database";
import { retirementRequest, FENCE_ACK } from "../cutover/retire";
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
