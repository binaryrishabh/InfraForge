import { expect, test } from "bun:test";
import { firewallSetup, firewallDesign } from "./firewallCapacity.fixture";
import { currentAdapterProfiles, contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { FIREWALL_FLOW_CAPACITY_MAX } from "@infraforge/domain/resource";
import { SYSTEM_LIMITS } from "../src/model2/systems/policy";
import { prepareSecurity } from "./securityCanvas.fixture";
import { createLiveModel2 } from "../src/model2/product/live";

test("explicit tracked connection capacity materializes exactly with owned provenance", () => {
  for (const maxFlows of [1, 2, FIREWALL_FLOW_CAPACITY_MAX]) {
    const f = firewallSetup("front", maxFlows);
    expect(currentAdapterProfiles(f.saved.resources)).toEqual(["firewall-flow-capacity/1"]);
    expect(f.compiled.input.systems.firewalls[0]).toMatchObject({ id: "firewall", maxFlows: { value: maxFlows } });
    expect(f.contract.ledger.find(r => r.id === "firewall.flows")).toMatchObject({ classification: "user-input", provenance: [expect.objectContaining({ source: "saved-design:firewall.firewallCapacity.maxFlows" })] });
  }
  expect(FIREWALL_FLOW_CAPACITY_MAX).toBe(SYSTEM_LIMITS.flows);
});
test("capacity requires exactly one matching captured and firewall-owned profile", () => {
  const f = firewallSetup("front", 2);
  for (const adapterProfiles of [[], ["object-capacity/1"], ["firewall-flow-capacity/1", "firewall-flow-capacity/1"]] as const) expect(contractFromDesign(f.saved, { adapterProfiles })).toHaveProperty("refused");
  expect(contractFromDesign(firewallDesign(), { adapterProfiles: ["firewall-flow-capacity/1"] })).toHaveProperty("refused");
  for (const version of ["canvas-assumptions/2", "canvas-assumptions/2/firewall-flow-capacity/2", "canvas-assumptions/2/firewall-flow-capacity/10", "canvas-assumptions/2/firewall-flow-capacity/1/firewall-flow-capacity/1"]) for (const owned of [true, false]) {
    const contract = structuredClone(f.contract);
    if (owned) contract.nodes.firewall!.profileVersion = version; else contract.version = version;
    expect(compileProduct(f.saved, contract).ok).toBe(false);
  }
  const contract = structuredClone(f.contract); contract.nodes.app!.profileVersion += "/firewall-flow-capacity/1";
  expect(compileProduct(f.saved, contract).ok).toBe(false);
});
test("compiler refuses capacity mismatch even with consistent ledger provenance", () => {
  const f = firewallSetup("front", 2), capacity = f.contract.nodes.firewall!.firewall!.maxFlows;
  if (capacity.kind !== "known") throw Error("Expected known capacity");
  capacity.value++;
  const row = f.contract.ledger.find(r => r.id === capacity.provenance[0])!;
  row.quantity = capacity; row.formula = String(capacity.value);
  const result = compileProduct(f.saved, f.contract);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(JSON.stringify(result.diagnostics)).toContain("must match saved intent");
});
test("capacity alone enables existing security evidence without requiring a rule edit", () => {
  const saved = firewallDesign("front", 2); delete saved.resources.find(r => r.id === "firewall")!.firewallSettings;
  const f = prepareSecurity(saved), live = createLiveModel2(f.compiled, saved.resources.map(r => r.id));
  live.advanceSecond();
  expect(live.project().metrics.firewall!.security!.firewall!.limit).toBe(2);
  expect(live.project().metrics.firewall!.health).toBe("unknown");
});
test("invalid capacity and wrong ownership refuse both adapter and direct compiler", () => {
  const good = firewallSetup("front", 2);
  for (const value of [null, {}, { version: 2, maxFlows: 2 }, { version: 1, maxFlows: 0 }, { version: 1, maxFlows: 100001 }, { version: 1, maxFlows: 1, timeout: 3 }]) {
    const saved = structuredClone(good.saved); Object.assign(saved.resources.find(r => r.id === "firewall")!, { firewallCapacity: value });
    expect(contractFromDesign(saved)).toHaveProperty("refused"); expect(compileProduct(saved, good.contract).ok).toBe(false);
  }
  const wrong = structuredClone(good.saved); Object.assign(wrong.resources.find(r => r.id === "app")!, { firewallCapacity: { version: 1, maxFlows: 2 } });
  expect(contractFromDesign(wrong)).toHaveProperty("refused"); expect(compileProduct(wrong, good.contract).ok).toBe(false);
});
