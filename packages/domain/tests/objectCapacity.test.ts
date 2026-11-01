import { expect, test } from "bun:test";
import { objectStoragePolicyError, OBJECT_STORAGE_CAPACITY_MAX_MIB } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation";

test("object byte ownership intent is optional, strict, bounded and owner-specific", () => {
  expect(objectStoragePolicyError("Virtual Machine", undefined)).toBeUndefined();
  for (const capacityMiB of [1, 2048, OBJECT_STORAGE_CAPACITY_MAX_MIB]) expect(objectStoragePolicyError("Object Storage", { version: 1, capacityMiB })).toBeUndefined();
  for (const p of [null, [], {}, { version: 2, capacityMiB: 1 }, { version: 1 }, ...[0, -1, 1.5, NaN, Infinity, "1", OBJECT_STORAGE_CAPACITY_MAX_MIB + 1].map(capacityMiB => ({ version: 1, capacityMiB })), { version: 1, capacityMiB: 1, replication: 2 }]) {
    expect(objectStoragePolicyError("Object Storage", p)).toBeDefined();
    const resource = { id: "store", type: "Object Storage" as const, x: 0, y: 0 };
    Object.assign(resource, { objectStoragePolicy: p });
    expect(validateDeploymentReadiness([resource], []).errors.some(e => e.startsWith("store:"))).toBe(true);
  }
  expect(objectStoragePolicyError("Virtual Machine", { version: 1, capacityMiB: 1 })).toBeDefined();
});
