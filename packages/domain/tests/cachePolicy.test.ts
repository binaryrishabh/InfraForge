import { expect, test } from "bun:test";
import { cachePolicyError, type Resource } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation";

test("cache policy is optional, explicit, strictly bounded and Cache-owned", () => {
  expect(cachePolicyError("Database", undefined)).toBeUndefined();
  for (const ttlSeconds of [undefined, 1, 60, 3600]) for (const singleFlight of [undefined, false, true]) {
    expect(cachePolicyError("Cache", { version: 1, ...(ttlSeconds === undefined ? {} : { ttlSeconds }), ...(singleFlight === undefined ? {} : { singleFlight }) })).toBeUndefined();
  }
  for (const ttlSeconds of [0, -1, 1.5, 3601, NaN, Infinity, "60", null]) expect(cachePolicyError("Cache", { version: 1, ttlSeconds })).toBeString();
  for (const singleFlight of [0, 1, "true", null, {}]) expect(cachePolicyError("Cache", { version: 1, singleFlight })).toBeString();
  for (const value of [null, [], {}, { version: 2 }, { version: 1, eviction: "lru" }]) expect(cachePolicyError("Cache", value)).toBeString();
  expect(cachePolicyError("Database", { version: 1, ttlSeconds: 1 })).toBeString();
});

test("deployment readiness refuses invalid cache policy before a run", () => {
  const resource: Resource = { id: "cache", type: "Cache", x: 0, y: 0, cachePolicy: { version: 1, ttlSeconds: 0 } };
  const result = validateDeploymentReadiness([resource], []);
  expect(result.valid).toBe(false); expect(result.errors.some(e => e.includes("Cache TTL"))).toBe(true);
});
