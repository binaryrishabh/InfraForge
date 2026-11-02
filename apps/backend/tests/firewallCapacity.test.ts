import { expect, test } from "bun:test";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { firewallLayout, firewallWorkload } from "./firewallCapacity.fixture";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration, designDifference } from "../comparison/design";

test("save/live/capture/replay/comparison preserve optional firewall capacity", () => {
  const old = firewallLayout();
  expect(configuration(old.resources[2]!)).not.toHaveProperty("firewallCapacity");
  expect(captureRunInputs(old, firewallWorkload).adapterProfiles).toEqual(["traffic-evidence/2"]);
  for (const maxFlows of [1, 2, 100000]) {
    const layout = firewallLayout(3), policy = { version: 1 as const, maxFlows };
    layout.resources[2]!.firewallCapacity = policy;
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(layout.resources).toEqual(schema.parse(layout).resources);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors).toEqual([]);
    const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, firewallWorkload, "firewall-flow-capacity"))));
    expect(input.adapterProfiles).toEqual(["firewall-flow-capacity/1"]);
    expect(buildContractFromRunInputs(input, 30)).not.toHaveProperty("refused");
    for (const adapterProfiles of [undefined, [], ["object-capacity/1"]] as const) expect(buildContractFromRunInputs({ ...input, adapterProfiles: adapterProfiles === undefined ? undefined : [...adapterProfiles] }, 30)).toHaveProperty("refused");
    expect(() => readRunInputs({ ...input, adapterProfiles: ["firewall-flow-capacity/1", "firewall-flow-capacity/1"] })).toThrow();
    expect(configuration(layout.resources[2]!)).toHaveProperty("firewallCapacity", policy);
    expect(designDifference(old, { ...old, resources: old.resources.map(r => r.id === "firewall" ? { ...r, firewallCapacity: policy } : r) }).reconfigured[0]!.fields).toEqual([{ field: "firewallCapacity", earlier: null, later: policy }]);
  }
});

test("invalid firewall capacity refuses layout/live/readiness/capture", () => {
  for (const policy of [null, {}, { version: 2, maxFlows: 1 }, { version: 1, maxFlows: 0 }, { version: 1, maxFlows: 1.5 }, { version: 1, maxFlows: 100001 }, { version: 1, maxFlows: 1, extra: true }]) {
    const layout = firewallLayout(); Object.assign(layout.resources[2]!, { firewallCapacity: policy });
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.some(e => e.startsWith("firewall:"))).toBe(true);
    expect(() => captureRunInputs(layout, firewallWorkload)).toThrow();
  }
  const wrong = firewallLayout(); wrong.resources[0]!.firewallCapacity = { version: 1, maxFlows: 1 };
  for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(wrong).success).toBe(false);
});
