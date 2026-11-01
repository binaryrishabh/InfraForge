import { expect, test } from "bun:test";
import { monitoringPolicyError, RESOURCE_TYPES } from "../src/resource";

const policy = { version: 2, bufferSamples: 8, batchSamples: 4, exportAttempts: 2 };
test("strict buffer v2 bounds and ownership retain strict cadence v1", () => {
  for (const p of [policy, { ...policy, bufferSamples: 1, batchSamples: 1, exportAttempts: 1 }, { ...policy, bufferSamples: 8192, batchSamples: 8192, exportAttempts: 10 }, { ...policy, collectionIntervalSeconds: 1, exportIntervalSeconds: 60 }]) expect(monitoringPolicyError("Monitoring Agent", p)).toBeUndefined();
  for (const type of Object.values(RESOURCE_TYPES)) if (type !== "Monitoring Agent") expect(monitoringPolicyError(type, policy)).toBeDefined();
  for (const field of ["bufferSamples", "batchSamples", "exportAttempts"]) {
    const missing = { ...policy } as Record<string, unknown>; delete missing[field];
    expect(monitoringPolicyError("Monitoring Agent", missing)).toBeDefined();
    for (const value of [0, -1, 1.5, NaN, Infinity, "2", null, undefined]) expect(monitoringPolicyError("Monitoring Agent", { ...policy, [field]: value })).toBeDefined();
  }
  for (const p of [{ ...policy, bufferSamples: 8193 }, { ...policy, batchSamples: 9 }, { ...policy, exportAttempts: 11 }, { ...policy, bufferBytes: 100 }, { ...policy, version: 3 }, { ...policy, version: 1 }, { ...policy, collectionIntervalSeconds: 61 }]) expect(monitoringPolicyError("Monitoring Agent", p)).toBeDefined();
});
