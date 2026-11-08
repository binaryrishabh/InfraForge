import { expect, test } from "bun:test";
import { DB_POOL_MAX_CONNECTIONS } from "@infraforge/domain/resource";
import { NETWORK_LIMITS } from "../src/model2/network/policy";
test("the saved application pool maximum uses the existing executor ceiling", () => {
  expect(DB_POOL_MAX_CONNECTIONS).toBe(NETWORK_LIMITS.connectionsPerPool);
});
