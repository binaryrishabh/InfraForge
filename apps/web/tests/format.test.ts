import { expect, test } from "bun:test";
import { plural } from "../src/lib/format";

test("counts read naturally at one and at many", () => {
  expect(plural(1, "connection")).toBe("1 connection");
  expect(plural(0, "resource")).toBe("0 resources");
  expect(plural(3, "replica")).toBe("3 replicas");
  expect(plural(2, "proxy", "proxies")).toBe("2 proxies");
});
