import { expect, test } from "bun:test";
import { firewallStateError, FIREWALL_IDLE_SECONDS_MAX } from "../src/resource";
import { validateDeploymentReadiness } from "../src/validation";

test("firewall idle state is optional, bounded, strict and owner-specific", () => {
  expect(firewallStateError("Virtual Machine", undefined)).toBeUndefined();
  for (const idleTimeoutSeconds of [1, 60, FIREWALL_IDLE_SECONDS_MAX]) expect(firewallStateError("Firewall", { version: 1, idleTimeoutSeconds })).toBeUndefined();
  for (const p of [null, [], {}, { version: 2, idleTimeoutSeconds: 1 }, { version: 1 }, ...[0, -1, 1.5, NaN, Infinity, "1", 3601].map(idleTimeoutSeconds => ({ version: 1, idleTimeoutSeconds })), { version: 1, idleTimeoutSeconds: 1, extra: true }]) {
    expect(firewallStateError("Firewall", p)).toBeDefined();
    const r = { id: "firewall", type: "Firewall" as const, x: 0, y: 0 }; Object.assign(r, { firewallState: p });
    expect(validateDeploymentReadiness([r], []).errors.some(e => e.startsWith("firewall:"))).toBe(true);
  }
  expect(firewallStateError("Virtual Machine", { version: 1, idleTimeoutSeconds: 1 })).toBeDefined();
});
