import { expect, test } from "bun:test";
import { vmCpuQuotaError, type Resource } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation/validateDeploymentReadiness.validation";

test("VM CPU limit is optional, strictly versioned, bounded and request VM owned", () => {
  expect(vmCpuQuotaError("Database", undefined)).toBeUndefined();
  for (const limitPercent of [1, 25, 100]) expect(vmCpuQuotaError("Virtual Machine", { version: 1, limitPercent })).toBeUndefined();
  for (const v of [null, [], {}, { version: 2, limitPercent: 25 }, { version: 1, limitPercent: 25, periodMs: 100 }, ...[0, 101, 1.5, NaN, Infinity, null, "25"].map(limitPercent => ({ version: 1, limitPercent }))]) expect(vmCpuQuotaError("Virtual Machine", v)).toBeString();
  const vmCpuQuota = { version: 1 as const, limitPercent: 25 };
  expect(vmCpuQuotaError("Database", vmCpuQuota)).toContain("request-serving");
  expect(vmCpuQuotaError("Virtual Machine", vmCpuQuota, true)).toContain("clear Application CPU limit");
  const vm: Resource = { id: "app", type: "Virtual Machine", x: 0, y: 0, vmCpuQuota, asyncWorker: { enabled: true } };
  expect(validateDeploymentReadiness([vm], []).errors.some(e => e.includes("clear Application CPU limit"))).toBe(true);
});
