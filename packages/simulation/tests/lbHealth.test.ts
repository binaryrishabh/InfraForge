import { expect, test } from "bun:test";
import { lbDesign, prepareLb } from "./lbAdmission.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";

test("partial health controls bind real engine quantities, empty intent keeps exact defaults", () => {
  for (const setting of [{ version: 1 as const, intervalSeconds: 1 }, { version: 1 as const, timeoutSeconds: 2 }, { version: 1 as const, unhealthyAfter: 3 }, { version: 1 as const, healthyAfter: 2 }]) {
    const d = lbDesign(); d.resources[0]!.lbHealth = setting;
    expect(prepareLb(d).compiled.input.resources.find(r => r.kind === "load-balancer")).toMatchObject({ health: {
      interval: { value: (setting.intervalSeconds ?? 5) * 1000000 }, timeout: { value: (setting.timeoutSeconds ?? 1) * 1000000 }, unhealthy: { value: setting.unhealthyAfter ?? 1 }, healthy: { value: setting.healthyAfter ?? 1 },
    } });
  }
  const d = lbDesign(), old = prepareLb(d); d.resources[0]!.lbHealth = { version: 1 };
  const next = prepareLb(d);
  expect(next.contract).toEqual(old.contract); expect(next.compiled).toEqual(old.compiled); expect(next.assumptions).toEqual(old.assumptions);
});

test("health and admission capture independently, and missing, duplicate or mismatched profiles refuse", () => {
  const d = lbDesign(); d.resources[0]!.lbHealth = { version: 1, intervalSeconds: 1 };
  expect(currentAdapterProfiles(d.resources)).toEqual(["lb-health/1"]);
  for (const adapterProfiles of [[], ["lb-health/1", "lb-health/1"]] as const) expect(contractFromDesign(d, { adapterProfiles })).toHaveProperty("refused");
  expect(contractFromDesign(lbDesign(), { adapterProfiles: ["lb-health/1"] })).toHaveProperty("refused");
  d.resources[0]!.lbAdmission = { version: 1, maxActive: 2 };
  expect(currentAdapterProfiles(d.resources)).toEqual(["lb-admission/1", "lb-health/1"]);
  const f = prepareLb(d);
  expect(f.contract.nodes.lb!.profileVersion).toContain("/lb-admission/1/lb-health/1");
  f.contract.version = f.contract.version.replace("/lb-health/1", "");
  expect(compileProduct(d, f.contract).ok).toBe(false);
});

test("compiler refuses health quantities that disagree with saved intent even with matching provenance", () => {
  const d = lbDesign(); d.resources[0]!.lbHealth = { version: 1, intervalSeconds: 5, timeoutSeconds: 2, unhealthyAfter: 3, healthyAfter: 2 };
  for (const field of ["interval", "timeout", "unhealthy", "healthy"] as const) {
    const f = prepareLb(d), lb = f.contract.nodes.lb!.resources.find(r => r.config.kind === "load-balancer")!.config;
    if (lb.kind !== "load-balancer") throw Error("Expected load balancer");
    const gate = lb.health[field]; if (gate.kind !== "known") throw Error("Expected known health policy"); gate.value++;
    const fact = f.contract.ledger.find(r => r.id === gate.provenance[0])!.quantity;
    if (fact.kind !== "known") throw Error("Expected health fact"); fact.value++;
    const result = compileProduct(d, f.contract);
    expect(result.ok).toBe(false); expect(result.diagnostics.some(r => r.message.includes("Load balancer health policy must match"))).toBe(true);
  }
});
