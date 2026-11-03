import { expect, test } from "bun:test";
import { lbSelectionError } from "../src/resource";

test("selection is versioned, closed and owned by a load balancer", () => {
  expect(lbSelectionError("Virtual Machine", undefined)).toBeUndefined();
  for (const policy of ["round-robin", "least-outstanding"]) expect(lbSelectionError("Load Balancer", { version: 1, policy })).toBeUndefined();
  for (const value of [null, [], {}, { version: 1 }, { version: 2, policy: "round-robin" }, { version: 1, policy: "random" }, { version: 1, policy: "round-robin", weight: 1 }]) expect(lbSelectionError("Load Balancer", value)).toBeString();
  expect(lbSelectionError("Virtual Machine", { version: 1, policy: "round-robin" })).toBeString();
});
