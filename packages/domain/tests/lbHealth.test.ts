import { expect, test } from "bun:test";
import { lbHealthError, type Resource } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation/validateDeploymentReadiness.validation";

test("health intent is strict, bounded, non-overlapping and owned only by a load balancer", () => {
  expect(lbHealthError("Database", undefined)).toBeUndefined();
  for (const value of [{ version: 1 }, { version: 1, intervalSeconds: 1 }, { version: 1, timeoutSeconds: 5 }, { version: 1, unhealthyAfter: 10, healthyAfter: 10 }, { version: 1, intervalSeconds: 60, timeoutSeconds: 60 }]) expect(lbHealthError("Load Balancer", value)).toBeUndefined();
  const invalid = [null, [], {}, { version: 2 }, { version: 1, provider: true }, { version: 1, timeoutSeconds: 6 }, { version: 1, intervalSeconds: 1, timeoutSeconds: 2 }];
  for (const [field, max] of [["intervalSeconds", 60], ["timeoutSeconds", 60], ["unhealthyAfter", 10], ["healthyAfter", 10]] as const) {
    for (const n of [0, -1, 1.5, max + 1, NaN, Infinity, null, "1"]) invalid.push({ version: 1, [field]: n });
  }
  for (const value of invalid) expect(lbHealthError("Load Balancer", value)).toBeString();
  expect(lbHealthError("Virtual Machine", { version: 1 })).toBeString();
  const lb: Resource = { id: "lb", type: "Load Balancer", x: 0, y: 0, lbHealth: { version: 1, unhealthyAfter: 0 } };
  expect(validateDeploymentReadiness([lb], []).errors.some(e => e.includes("unhealthyAfter"))).toBe(true);
});
