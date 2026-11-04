import { expect, test } from "bun:test";
import { databaseReadRoutingError, type Resource } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation/validateDeploymentReadiness.validation";

const replication = { version: 1 as const, enabled: true as const, replicationDelayMs: 100, readPolicy: "primary" as const };
test("read routing is strict, versioned, optional and requires an owned replica", () => {
  expect(databaseReadRoutingError("Cache", undefined)).toBeUndefined();
  for (const policy of ["primary-only", "replica-preferred"] as const) expect(databaseReadRoutingError("Database", { version: 1, policy }, replication)).toBeUndefined();
  for (const value of [null, [], {}, { version: 2, policy: "primary-only" }, { version: 1, policy: "any" }, { version: 1, policy: "primary-only", fallback: true }]) expect(databaseReadRoutingError("Database", value, replication)).toBeString();
  const policy = { version: 1 as const, policy: "primary-only" as const };
  expect(databaseReadRoutingError("Cache", policy, replication)).toBeString();
  expect(databaseReadRoutingError("Database", policy)).toBeString();
  const db: Resource = { id: "db", type: "Database", x: 0, y: 0, databaseReadRouting: policy };
  expect(validateDeploymentReadiness([db], []).errors.some(error => error.includes("read routing"))).toBe(true);
});
