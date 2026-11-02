import { expect, test } from "bun:test";
import { vmMemoryError } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation";

const good = { version: 1, baselineMiB: 0, requestMiB: 1, activeMiB: 0 };
test("modeled memory is optional, bounded, strict and must grow", () => {
  expect(vmMemoryError("Database", undefined)).toBeUndefined();
  expect(vmMemoryError("Virtual Machine", good)).toBeUndefined();
  expect(vmMemoryError("Virtual Machine", { ...good, requestMiB: 0, activeMiB: 1048576 })).toBeUndefined();
  for (const value of [null, [], {}, { ...good, version: 2 }, { ...good, extra: 1 }, { ...good, requestMiB: 0 },
    ...[-1, 1048577, 1.5, NaN, Infinity, null, "1"].flatMap(n => ["baselineMiB", "requestMiB", "activeMiB"].map(k => ({ ...good, [k]: n })))]) {
    expect(vmMemoryError("Virtual Machine", value)).toBeString();
  }
  expect(vmMemoryError("Database", good)).toContain("request-serving Virtual Machine");
  expect(vmMemoryError("Virtual Machine", good, true)).toContain("Background worker");
  expect(validateDeploymentReadiness([{ id: "app", type: "Virtual Machine", x: 0, y: 0, vmMemory: { ...good, version: 1, requestMiB: 0 } }], []).valid).toBe(false);
});
