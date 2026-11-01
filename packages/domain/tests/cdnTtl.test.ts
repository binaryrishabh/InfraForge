import { expect, test } from "bun:test";
import { cdnCachePolicyError, RESOURCE_TYPES } from "../src/resource";

test("CDN freshness policy v1 requires an integer TTL and refuses every other owner", () => {
  for (const ttlSeconds of [1, 60, 3600]) expect(cdnCachePolicyError("CDN", { version: 1, ttlSeconds })).toBeUndefined();
  for (const type of Object.values(RESOURCE_TYPES)) {
    expect(cdnCachePolicyError(type, undefined)).toBeUndefined();
    if (type !== "CDN") expect(cdnCachePolicyError(type, { version: 1, ttlSeconds: 60 })).toContain("CDN");
  }
  for (const value of [null, [], {}, { version: 1 }, { version: 2, ttlSeconds: 60 }, { version: 1, ttlSeconds: 60, coalesce: true }, ...[0, -1, 3601, 1.5, NaN, Infinity, "60", null].map(ttlSeconds => ({ version: 1, ttlSeconds }))]) expect(cdnCachePolicyError("CDN", value)).toBeDefined();
});
