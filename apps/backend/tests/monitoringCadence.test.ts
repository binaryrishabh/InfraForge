import { expect, test } from "bun:test";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { monitoringLayout, monitoringWorkload } from "./monitoringCadence.fixture";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration, designDifference } from "../comparison/design";

for (const policy of [{ version: 1 as const }, { version: 1 as const, collectionIntervalSeconds: 1 }, { version: 1 as const, exportIntervalSeconds: 60 }, { version: 1 as const, collectionIntervalSeconds: 60, exportIntervalSeconds: 1 }]) test(`cadence boundary capture, comparison and replay: ${JSON.stringify(policy)}`, () => {
  const layout = monitoringLayout(policy), changed = "collectionIntervalSeconds" in policy || "exportIntervalSeconds" in policy;
  for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.parse(layout).resources).toEqual(layout.resources);
  expect(validateDeploymentReadiness(layout.resources, layout.connectionLines)).toEqual(validateDeploymentReadiness(monitoringLayout().resources, layout.connectionLines));
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, monitoringWorkload, "monitor-cadence"))));
  expect(input.adapterProfiles).toEqual(changed ? ["monitor-cadence/1"] : []);
  expect(buildContractFromRunInputs(input, 65)).not.toHaveProperty("refused");
  if (changed) for (const adapterProfiles of [undefined, []]) expect(buildContractFromRunInputs({ ...input, adapterProfiles }, 65)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...input, adapterProfiles: ["monitor-cadence/1", "monitor-cadence/1"] })).toThrow();
  expect(configuration(layout.resources[1]!)).toHaveProperty("monitoringPolicy", policy);
  expect(configuration(monitoringLayout().resources[1]!)).not.toHaveProperty("monitoringPolicy");
  expect(designDifference(monitoringLayout(), layout).reconfigured[0]!.fields).toEqual([{ field: "monitoringPolicy", earlier: null, later: policy }]);
});

test("old captures keep no cadence profile; mismatched capture refuses", () => {
  const input = captureRunInputs(monitoringLayout(), monitoringWorkload, "old-monitor");
  expect(input.adapterProfiles).toEqual([]);
  const { adapterProfiles: _profiles, ...old } = input;
  expect(readRunInputs(old)).not.toHaveProperty("adapterProfiles");
  expect(buildContractFromRunInputs(old, 65)).not.toHaveProperty("refused");
  expect(buildContractFromRunInputs({ ...input, adapterProfiles: ["monitor-cadence/1"] }, 65)).toHaveProperty("refused");
});

test("invalid version, fields, values and owners refuse layout, live, readiness and replay", () => {
  for (const policy of [null, {}, { version: 2 }, { version: 1, freshFor: 30 }, { version: 1, attempts: 2 }, ...[0, 61, 1.5, null, "2"].flatMap(value => [{ version: 1, collectionIntervalSeconds: value }, { version: 1, exportIntervalSeconds: value }])]) {
    const layout = monitoringLayout(); Object.assign(layout.resources[1]!, { monitoringPolicy: policy });
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.some(e => e.startsWith("monitor:"))).toBe(true);
    expect(() => captureRunInputs(layout, monitoringWorkload)).toThrow();
  }
  const layout = monitoringLayout(); layout.resources[0]!.monitoringPolicy = { version: 1, collectionIntervalSeconds: 2 };
  for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
  expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.some(e => e.startsWith("vm:"))).toBe(true);
});
