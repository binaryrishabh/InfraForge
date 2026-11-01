import { expect, test } from "bun:test";
import { dbConcurrencyError, type Resource } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation/validateDeploymentReadiness.validation";

test("database concurrency is optional, explicit, bounded and database owned", () => {
  expect(dbConcurrencyError("Cache", undefined)).toBeUndefined();
  for (const value of [{ version: 1 }, { version: 1, activeQueries: 1 }, { version: 1, queuedQueries: 0 }, { version: 1, activeQueries: 512, queuedQueries: 1000 }]) expect(dbConcurrencyError("Database", value)).toBeUndefined();
  for (const value of [null, [], {}, { version: 2 }, { version: 1, sessions: 10 }, ...[0, -1, 1.5, 513, NaN, Infinity, null, "1"].map(activeQueries => ({ version: 1, activeQueries })), ...[-1, 1.5, 1001, NaN, Infinity, null, "1"].map(queuedQueries => ({ version: 1, queuedQueries }))]) expect(dbConcurrencyError("Database", value)).toBeString();
  expect(dbConcurrencyError("Cache", { version: 1, activeQueries: 1 })).toBeString();
  const db: Resource = { id: "db", type: "Database", x: 0, y: 0, dbConcurrency: { version: 1, activeQueries: 0 } };
  expect(validateDeploymentReadiness([db], []).errors.some(e => e.includes("activeQueries"))).toBe(true);
});
