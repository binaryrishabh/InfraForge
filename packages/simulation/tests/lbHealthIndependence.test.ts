import { expect, test } from "bun:test";
import { healthPolicy, healthScenario, observeHealth } from "./lbHealth.fixture";

for (const fault of ["crash", "delay"] as const) test(`${fault} observations and exclusion stay confined to the affected backend`, () => {
  const normal = observeHealth(healthScenario(healthPolicy, { fault: "none", rps: 10 }));
  const affected = observeHealth(healthScenario(healthPolicy, { fault, rps: 10 }));
  const survivorChecks = (r: typeof normal) => r.evidence.network.trace.events.filter(e => e.kind === "health-observation" && JSON.parse(e.id)[2] === "survivor");
  expect(survivorChecks(affected)).toEqual(survivorChecks(normal));
  expect(survivorChecks(affected).length).toBeGreaterThan(0);
  expect(survivorChecks(affected).every(e => e.detail === "passed:eligible=true")).toBe(true);
  expect(affected.removed).toBeNumber(); expect(affected.returned).toBeNumber();
  const during = affected.selected.filter(e => e.at > affected.removed! && e.at < affected.returned!);
  expect(during.length).toBeGreaterThan(0); expect(during.every(e => e.detail === "survivor")).toBe(true);
  const b = affected.evidence.network.loadBalancers[0]!.backends;
  expect(b.every(m => m.health)).toBe(true); expect(b.find(m => m.id === "survivor")!.failures).toBe(0);
  console.info("lb-health-independent", JSON.stringify({ fault, removed: affected.removed, returned: affected.returned, survivorChecks: survivorChecks(affected).length, selectedDuringExclusion: during.length }));
});
