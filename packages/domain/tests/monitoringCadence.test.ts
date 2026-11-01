import { expect, test } from "bun:test";
import { monitoringPolicyError, RESOURCE_TYPES } from "../src/resource";

test("monitoring v1 is strict, bounded and owned only by Monitoring Agent", () => {
  for (const collectionIntervalSeconds of [undefined, 1, 10, 60]) for (const exportIntervalSeconds of [undefined, 1, 10, 60]) {
    const p = { version: 1, ...(collectionIntervalSeconds === undefined ? {} : { collectionIntervalSeconds }), ...(exportIntervalSeconds === undefined ? {} : { exportIntervalSeconds }) };
    expect(monitoringPolicyError("Monitoring Agent", p)).toBeUndefined();
    for (const type of Object.values(RESOURCE_TYPES)) if (type !== "Monitoring Agent") expect(monitoringPolicyError(type, p)).toBeDefined();
  }
  for (const p of [null, [], {}, { version: 2 }, { version: 1, freshFor: 30 }, { version: 1, bufferSamples: 10 }, ...[0, 61, -1, 1.5, NaN, Infinity, "2", null].flatMap(value => [{ version: 1, collectionIntervalSeconds: value }, { version: 1, exportIntervalSeconds: value }])]) expect(monitoringPolicyError("Monitoring Agent", p)).toBeDefined();
});
