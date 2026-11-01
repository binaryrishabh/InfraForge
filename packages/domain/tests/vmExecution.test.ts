import { expect, test } from "bun:test";
import { vmExecutionError, type Resource } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation/validateDeploymentReadiness.validation";

test("VM execution is optional, versioned, bounded and VM owned", () => {
  expect(vmExecutionError("Database", undefined)).toBeUndefined();
  for (const v of [{ version: 1 }, { version: 1, workers: 1 }, { version: 1, queuedRequests: 0 }, { version: 1, workers: 512, queuedRequests: 1000 }]) expect(vmExecutionError("Virtual Machine", v)).toBeUndefined();
  for (const v of [null, [], {}, { version: 2 }, { version: 1, threads: 10 }, ...[0, -1, 1.5, 513, NaN, Infinity, null, "1"].map(workers => ({ version: 1, workers })), ...[-1, 1.5, 1001, NaN, Infinity, null, "1"].map(queuedRequests => ({ version: 1, queuedRequests }))]) expect(vmExecutionError("Virtual Machine", v)).toBeString();
  expect(vmExecutionError("Database", { version: 1, workers: 1 })).toBeString();
  const vm: Resource = { id: "app", type: "Virtual Machine", x: 0, y: 0, vmExecution: { version: 1, workers: 0 } };
  expect(validateDeploymentReadiness([vm], []).errors.some(e => e.includes("workers"))).toBe(true);
});

test("any saved execution value refuses async ownership until the learner clears it", () => {
  const vm: Resource = { id: "worker", type: "Virtual Machine", x: 0, y: 0, asyncWorker: { enabled: true } };
  expect(vmExecutionError(vm.type, undefined, true)).toBeUndefined();
  for (const vmExecution of [{ version: 1 as const }, { version: 1 as const, workers: 1 }, { version: 1 as const, queuedRequests: 0 }]) {
    expect(vmExecutionError(vm.type, vmExecution, true)).toContain("clear VM execution settings");
    expect(validateDeploymentReadiness([{ ...vm, vmExecution }], []).errors.some(e => e.includes("clear VM execution settings"))).toBe(true);
  }
  expect(vmExecutionError(vm.type, { version: 1, workers: 1 }, false)).toBeUndefined();
});
