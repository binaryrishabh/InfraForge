import { expect, test } from "bun:test";
import { cachePolicyError } from "../src/resource";

test("logical cache capacity is explicit, versioned and bounded without extending version 1", () => {
  for (const capacityEntries of [1, 10, 100, 1000]) {
    expect(cachePolicyError("Cache", { version: 2, capacityEntries, ttlSeconds: 1, singleFlight: true })).toBeUndefined();
    expect(cachePolicyError("Cache", { version: 1, capacityEntries })).toBeString();
    expect(cachePolicyError("Database", { version: 2, capacityEntries })).toBeString();
  }
  for (const capacityEntries of [undefined, null, 0, -1, 1.5, 1001, NaN, Infinity, "10"]) expect(cachePolicyError("Cache", { version: 2, capacityEntries })).toBeString();
  for (const policy of [{ version: 2, capacityEntries: 10, ttlSeconds: 0 }, { version: 2, capacityEntries: 10, singleFlight: "on" }, { version: 2, capacityEntries: 10, eviction: "lru" }]) expect(cachePolicyError("Cache", policy)).toBeString();
});
