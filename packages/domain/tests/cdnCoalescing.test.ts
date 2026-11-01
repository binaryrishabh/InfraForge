import { expect, test } from "bun:test";
import { cdnCachePolicyError, RESOURCE_TYPES } from "../src/resource";

test("CDN v2 requires coalescing intent and permits only bounded shared-fill limits when On", () => {
  for (const coalesce of [true, false]) for (const ttlSeconds of [undefined, 1, 3600]) {
    const policy = { version: 2, coalesce, ...(ttlSeconds === undefined ? {} : { ttlSeconds }) };
    expect(cdnCachePolicyError("CDN", policy)).toBeUndefined();
    for (const type of Object.values(RESOURCE_TYPES)) if (type !== "CDN") expect(cdnCachePolicyError(type, policy)).toBeDefined();
  }
  for (const maxWaiters of [1, 256, 100000]) expect(cdnCachePolicyError("CDN", { version: 2, coalesce: true, maxWaiters })).toBeUndefined();
  for (const value of [null, {}, { version: 2 }, { version: 2, ttlSeconds: 60 }, { version: 2, coalesce: "true" }, { version: 2, coalesce: true, extra: 1 }, { version: 2, coalesce: false, maxWaiters: 256 }, { version: 1, ttlSeconds: 60, coalesce: true }, { version: 1, ttlSeconds: 60, maxWaiters: 256 }, ...[0, -1, 100001, 1.5, NaN, Infinity, "2", null].map(maxWaiters => ({ version: 2, coalesce: true, maxWaiters })), ...[0, 3601, 1.5, null].map(ttlSeconds => ({ version: 2, coalesce: true, ttlSeconds }))]) expect(cdnCachePolicyError("CDN", value)).toBeDefined();
});
