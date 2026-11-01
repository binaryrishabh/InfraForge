import { expect, test } from "bun:test";
import type { AdapterProfile } from "@infraforge/contracts/run-inputs";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { monitoringLayout, monitoringWorkload } from "./monitoringCadence.fixture";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration, designDifference } from "../comparison/design";

const policy = { version: 2 as const, bufferSamples: 8, batchSamples: 4, exportAttempts: 3 };
test("buffer boundary capture, comparison, composed cadence and replay", () => {
  for (const cadence of [false, true]) {
    const p = { ...policy, ...(cadence ? { collectionIntervalSeconds: 2 } : {}) }, layout = monitoringLayout(p);
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.parse(layout).resources).toEqual(layout.resources);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors).toEqual([]);
    const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, monitoringWorkload, "monitor-buffer"))));
    const expectedProfiles: AdapterProfile[] = cadence ? ["monitor-cadence/1", "monitor-buffer/1"] : ["monitor-buffer/1"];
    expect(input.adapterProfiles).toEqual(expectedProfiles);
    expect(buildContractFromRunInputs(input, 65)).not.toHaveProperty("refused");
    for (const adapterProfiles of [undefined, [], ["monitor-cadence/1"]] as const) expect(buildContractFromRunInputs({ ...input, adapterProfiles: adapterProfiles === undefined ? undefined : [...adapterProfiles] }, 65)).toHaveProperty("refused");
    expect(() => readRunInputs({ ...input, adapterProfiles: ["monitor-buffer/1", "monitor-buffer/1"] })).toThrow();
    expect(configuration(layout.resources[1]!)).toHaveProperty("monitoringPolicy", p);
    expect(designDifference(monitoringLayout(), layout).reconfigured[0]!.fields).toEqual([{ field: "monitoringPolicy", earlier: null, later: p }]);
  }
});
test("invalid buffer policies refuse save/live, readiness and capture", () => {
  for (const p of [{ ...policy, bufferSamples: 8193 }, { ...policy, batchSamples: 9 }, { ...policy, exportAttempts: 11 }, { ...policy, bufferBytes: 100 }, { version: 2, bufferSamples: 8 }, { ...policy, version: 1 }]) {
    const layout = monitoringLayout(); Object.assign(layout.resources[1]!, { monitoringPolicy: p });
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.some(e => e.startsWith("monitor:"))).toBe(true);
    expect(() => captureRunInputs(layout, monitoringWorkload)).toThrow();
  }
  const layout = monitoringLayout(); layout.resources[0]!.monitoringPolicy = policy;
  for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
});
