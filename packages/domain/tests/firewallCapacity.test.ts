import { expect, test } from "bun:test";
import { firewallCapacityError, FIREWALL_FLOW_CAPACITY_MAX } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation";

test("firewall flow capacity intent is optional, strict, bounded and owner-specific", () => {
  expect(firewallCapacityError("Virtual Machine", undefined)).toBeUndefined();
  for (const maxFlows of [1, 2048, FIREWALL_FLOW_CAPACITY_MAX]) expect(firewallCapacityError("Firewall", { version: 1, maxFlows })).toBeUndefined();
  for (const p of [null, [], {}, { version: 2, maxFlows: 1 }, { version: 1 }, ...[0, -1, 1.5, NaN, Infinity, "1", FIREWALL_FLOW_CAPACITY_MAX + 1].map(maxFlows => ({ version: 1, maxFlows })), { version: 1, maxFlows: 1, timeout: 2 }]) {
    expect(firewallCapacityError("Firewall", p)).toBeDefined();
    const resource = { id: "firewall", type: "Firewall" as const, x: 0, y: 0 };
    Object.assign(resource, { firewallCapacity: p });
    expect(validateDeploymentReadiness([resource], []).errors.some(e => e.startsWith("firewall:"))).toBe(true);
  }
  expect(firewallCapacityError("Virtual Machine", { version: 1, maxFlows: 1 })).toBeDefined();
});
