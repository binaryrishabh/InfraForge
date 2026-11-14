import { expect, test } from "bun:test";
import { rowLockingError } from "../src/resource";

const ok = { version: 1, rowsPerWrite: 2, order: "by-key" };
const keyspace = { count: 10 };

test("a strict row lock order on a Database with at least two rows is accepted for both values", () => {
  expect(rowLockingError("Database", ok, keyspace)).toBeUndefined();
  expect(rowLockingError("Database", { ...ok, order: "as-requested" }, keyspace)).toBeUndefined();
  expect(rowLockingError("Database", undefined)).toBeUndefined();
});

test("unknown fields, wrong values, the wrong resource and too few rows are refused", () => {
  for (const bad of [null, [], "by-key", {}, { version: 1 }, { ...ok, order: "random" }, { ...ok, order: undefined }, { ...ok, rowsPerWrite: 3 }, { ...ok, rowsPerWrite: 1 }, { ...ok, version: 2 }, { ...ok, extra: true }]) expect(rowLockingError("Database", bad, keyspace)).toBeString();
  expect(rowLockingError("Cache", ok, keyspace)).toBe("Row locking belongs to a Database.");
  for (const k of [undefined, { count: 1 }, { count: 0 }]) expect(rowLockingError("Database", ok, k)).toBe("Row locking needs a saved data keyspace of at least two rows.");
});
