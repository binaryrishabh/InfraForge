import { expect, test } from "bun:test";
import { dataKeyspaceError, DATA_KEYSPACE_MAX, type Resource } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation";

test("database owns an optional versioned bounded keyspace", () => {
  expect(dataKeyspaceError("Virtual Machine", undefined)).toBeUndefined();
  for (const count of [1, 10, 100, DATA_KEYSPACE_MAX]) expect(dataKeyspaceError("Database", { version: 1, count })).toBeUndefined();
  for (const value of [null, [], {}, 10, { version: 2, count: 10 }, { version: 1, count: "10" },
    ...[0, -1, 1.5, 1001, NaN, Infinity].map(count => ({ version: 1, count })), { version: 1, count: 10, skew: true }]) {
    expect(dataKeyspaceError("Database", value)).toBeString();
  }
  expect(dataKeyspaceError("Cache", { version: 1, count: 10 })).toBeString();
});

test("canvas readiness refuses invalid keyspace without needing the server schema", () => {
  const app: Resource = { id: "app", type: "Virtual Machine", x: 0, y: 0 };
  const db: Resource = { id: "db", type: "Database", x: 0, y: 0, dataKeyspace: { version: 1, count: 1001 } };
  const links = [{ id: "data", sourceId: "app", targetId: "db", sourceType: app.type, targetType: db.type, port: 5432 }];
  expect(validateDeploymentReadiness([app, db], links).valid).toBe(false);
  db.dataKeyspace!.count = 1000;
  expect(validateDeploymentReadiness([app, db], links).valid).toBe(true);
});
