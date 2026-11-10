import { expect, test } from "bun:test";
import { artifactCachePolicyError } from "@infraforge/domain/resource";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration } from "../comparison/design";
import { reviewDesignChanges } from "../challenges/designChanges";
import { StartupSchema } from "../reports/startupSchema";
import { artifactLayout, artifactWorkload } from "./artifactCache.fixture";

test("save/live/captured replay/comparison preserve the single byte-admission setting", () => {
  expect(artifactCachePolicyError("Database", undefined)).toBeUndefined();
  const inputs = [256, 4096, Number.MAX_SAFE_INTEGER].map(capacity => {
    const layout = artifactLayout(capacity);
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.parse(layout).resources).toEqual(layout.resources);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors).toEqual([]);
    const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, artifactWorkload, "artifact-capture"))));
    expect(input.resources).toEqual(layout.resources); expect(input.adapterProfiles).toContain("artifact-cache/1");
    expect(buildContractFromRunInputs(input, 20)).not.toHaveProperty("refused");
    expect(configuration(input.resources[1]!)).toHaveProperty("artifactCachePolicy.capacityBytes", capacity);
    for (const adapterProfiles of [undefined, [], ["lb-health/1"]] as const) expect(buildContractFromRunInputs({...input, adapterProfiles: adapterProfiles === undefined ? undefined : [...adapterProfiles]}, 20)).toHaveProperty("refused");
    expect(() => readRunInputs({...input, adapterProfiles: ["artifact-cache/1", "artifact-cache/1"]})).toThrow();
    return input;
  });
  expect(reviewDesignChanges(inputs[0]!, inputs[1]!)).toMatchObject({classification: "one-change", count: 1, differences: {reconfigured: [{id: "app", fields: [{field: "artifactCachePolicy", earlier: {version: 1, capacityBytes: 256}, later: {version: 1, capacityBytes: 4096}}]}]}});
  const old = artifactLayout(); expect(configuration(old.resources[1]!)).not.toHaveProperty("artifactCachePolicy");
  expect(captureRunInputs(old, artifactWorkload).adapterProfiles).not.toContain("artifact-cache/1");
});
test("malformed/unsafe capacities and disabled or foreign owners refuse at each saved admission boundary", () => {
  const bad = [null, {}, [], {version: 2, capacityBytes: 1024}, ...[0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1024"].map(capacityBytes => ({version: 1, capacityBytes})), {version: 1, capacityBytes: 1024, sharing: true}];
  for (const policy of bad) {
    const layout = artifactLayout(); Object.assign(layout.resources[1]!, {artifactCachePolicy: policy});
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).valid).toBe(false);
    expect(() => captureRunInputs(layout, artifactWorkload)).toThrow();
  }
  for (const resource of [{type: "Database"}, {type: "Load Balancer"}, {autoscaling: undefined}, {autoscaling: {enabled: false}}, {autoscaling: {}}]) {
    const layout = artifactLayout(1024); Object.assign(layout.resources[1]!, resource);
    expect(LayoutSchema.safeParse(layout).success).toBe(false);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).valid).toBe(false);
  }
});
test("optional startup capacity validates safe bounds and byte ownership without repairing missing values", () => {
  for (const capacityBytes of [null, undefined, 1, Number.MAX_SAFE_INTEGER]) expect(StartupSchema.safeParse({version: 1, clients: [{id: "app#1/image", capacityBytes}]}).success).toBe(true);
  for (const capacityBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(StartupSchema.safeParse({version: 1, clients: [{id: "app#1/image", capacityBytes}]}).success).toBe(false);
  expect(StartupSchema.safeParse({version: 1, clients: [{id: "app#1/image", capacityBytes: 256, cachedBytes: 1024}]}).success).toBe(false);
  expect(StartupSchema.parse({version: 1, clients: [{id: "app#1/image"}]}).clients![0]).not.toHaveProperty("capacityBytes");
});
