import { expect, test } from "bun:test";
import { asyncSettingsError, DEFAULT_ASYNC_WORKER_SETTINGS, DEFAULT_ASYNC_QUEUE_SETTINGS, type Resource } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation/validateDeploymentReadiness.validation";

test("idempotent result intent is optional, boolean, strictly owned and has no injected default", () => {
  expect(DEFAULT_ASYNC_WORKER_SETTINGS).not.toHaveProperty("idempotentResults");
  for (const enabled of [false, true]) for (const idempotentResults of [undefined, false, true]) expect(asyncSettingsError("Virtual Machine", undefined, { ...DEFAULT_ASYNC_WORKER_SETTINGS, enabled, idempotentResults })).toBeUndefined();
  for (const idempotentResults of [null, 0, 1, "true", {}, []]) expect(asyncSettingsError("Virtual Machine", undefined, { ...DEFAULT_ASYNC_WORKER_SETTINGS, ...{ idempotentResults } } as never)).toBeDefined();
  expect(asyncSettingsError("Database", undefined, { ...DEFAULT_ASYNC_WORKER_SETTINGS, idempotentResults: true })).toBeDefined();
  expect(asyncSettingsError("Message Queue", { ...DEFAULT_ASYNC_QUEUE_SETTINGS, ...{ idempotentResults: true } })).toBeDefined();
});

test("deployment validation refuses enabled idempotent worker database dependencies", () => {
  const resources: Resource[] = [{ id: "worker", type: "Virtual Machine", x: 0, y: 0, asyncWorker: { ...DEFAULT_ASYNC_WORKER_SETTINGS, idempotentResults: true } }, { id: "db", type: "Database", x: 1, y: 0 }];
  const result = validateDeploymentReadiness(resources, [{ id: "db-edge", sourceId: "worker", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 }]);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.includes("Idempotent result writes protect Object Storage only"))).toBe(true);
});
