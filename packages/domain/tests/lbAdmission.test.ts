import { expect, test } from "bun:test";
import { lbAdmissionError, type Resource } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation/validateDeploymentReadiness.validation";

test("admission intent is strict, bounded and owned only by a load balancer", () => {
  expect(lbAdmissionError("Database", undefined)).toBeUndefined();
  for (const value of [{ version: 1 }, { version: 1, maxActive: 1 }, { version: 1, maxQueued: 0 }, { version: 1, maxActive: 65536, maxQueued: 100000, queueWaitMs: 60000 }]) expect(lbAdmissionError("Load Balancer", value)).toBeUndefined();
  for (const value of [null, [], {}, { version: 2 }, { version: 1, provider: true }, ...[0, -1, 1.5, 65537, NaN, Infinity, null, "1"].map(maxActive => ({ version: 1, maxActive })), ...[-1, 1.5, 100001, NaN, Infinity, null, "1"].map(maxQueued => ({ version: 1, maxQueued })), ...[0, -1, 1.5, 60001, NaN, Infinity, null, "1"].map(queueWaitMs => ({ version: 1, queueWaitMs }))]) expect(lbAdmissionError("Load Balancer", value)).toBeString();
  expect(lbAdmissionError("Virtual Machine", { version: 1, maxActive: 1 })).toBeString();
  const lb: Resource = { id: "lb", type: "Load Balancer", x: 0, y: 0, lbAdmission: { version: 1, maxActive: 0 } };
  expect(validateDeploymentReadiness([lb], []).errors.some(e => e.includes("maxActive"))).toBe(true);
});
