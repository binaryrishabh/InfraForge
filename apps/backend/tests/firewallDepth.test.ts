import { expect, test } from "bun:test";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { firewallLayout, firewallWorkload } from "./firewallCapacity.fixture";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration, designDifference } from "../comparison/design";

test("save/live/capture/replay/comparison preserve optional firewall state", () => {
  const old = firewallLayout();
  expect(configuration(old.resources[2]!)).not.toHaveProperty("firewallState");
  expect(captureRunInputs(old, firewallWorkload).adapterProfiles).toEqual(["traffic-evidence/2"]);
  for (const idleTimeoutSeconds of [1, 2, 3600]) {
    const layout = firewallLayout(), policy = { version: 1 as const, idleTimeoutSeconds };
    layout.resources[2]!.firewallState = policy;
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(layout.resources).toEqual(schema.parse(layout).resources);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors).toEqual([]);
    const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, firewallWorkload, "firewall-state"))));
    expect(input.adapterProfiles).toEqual(["failure-cause/1", "firewall-state/1", "traffic-evidence/2"]);
    expect(buildContractFromRunInputs(input, 30)).not.toHaveProperty("refused");
    for (const adapterProfiles of [undefined, [], ["object-capacity/1"]] as const) expect(buildContractFromRunInputs({ ...input, adapterProfiles: adapterProfiles === undefined ? undefined : [...adapterProfiles] }, 30)).toHaveProperty("refused");
    expect(() => readRunInputs({ ...input, adapterProfiles: ["firewall-state/1", "firewall-state/1"] })).toThrow();
    expect(configuration(layout.resources[2]!)).toHaveProperty("firewallState", policy);
    expect(designDifference(old, { ...old, resources: old.resources.map(r => r.id === "firewall" ? { ...r, firewallState: policy } : r) }).reconfigured[0]!.fields).toEqual([{ field: "firewallState", earlier: null, later: policy }]);
  }
});

test("invalid firewall state refuses layout/live/readiness/capture", () => {
  for (const policy of [null, {}, { version: 2, idleTimeoutSeconds: 1 }, { version: 1, idleTimeoutSeconds: 0 }, { version: 1, idleTimeoutSeconds: 1.5 }, { version: 1, idleTimeoutSeconds: 3601 }, { version: 1, idleTimeoutSeconds: 1, extra: true }]) {
    const layout = firewallLayout(); Object.assign(layout.resources[2]!, { firewallState: policy });
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.some(e => e.startsWith("firewall:"))).toBe(true);
    expect(() => captureRunInputs(layout, firewallWorkload)).toThrow();
  }
  const wrong = firewallLayout(); wrong.resources[0]!.firewallState = { version: 1, idleTimeoutSeconds: 1 };
  for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(wrong).success).toBe(false);
});
