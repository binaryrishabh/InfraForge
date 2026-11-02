import { expect, test } from "bun:test";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { capacityLayout, capacityWorkload } from "./queueCapacity.fixture";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration, designDifference } from "../comparison/design";

test("save/live/capture/replay/comparison preserve optional object capacity with Queue Depth 2", () => {
  const old = capacityLayout();
  expect(configuration(old.resources[3]!)).not.toHaveProperty("objectStoragePolicy");
  expect(captureRunInputs(old, capacityWorkload).adapterProfiles).toEqual(["traffic-evidence/2"]);
  for (const capacityMiB of [1, 2, 8589934591]) {
    const layout = capacityLayout(3), policy = { version: 1 as const, capacityMiB };
    layout.resources[3]!.objectStoragePolicy = policy;
    layout.resources[2]!.asyncWorker!.idempotentResults = true;
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(layout.resources).toEqual(schema.parse(layout).resources);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors).toEqual([]);
    const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, capacityWorkload, "object-capacity"))));
    expect(input.adapterProfiles).toEqual(["queue-capacity/1", "queue-idempotency/1", "object-capacity/1"]);
    expect(buildContractFromRunInputs(input, 30)).not.toHaveProperty("refused");
    for (const adapterProfiles of [undefined, [], ["queue-capacity/1", "queue-idempotency/1"]] as const) expect(buildContractFromRunInputs({ ...input, adapterProfiles: adapterProfiles === undefined ? undefined : [...adapterProfiles] }, 30)).toHaveProperty("refused");
    expect(() => readRunInputs({ ...input, adapterProfiles: ["object-capacity/1", "object-capacity/1"] })).toThrow();
    expect(configuration(layout.resources[3]!)).toHaveProperty("objectStoragePolicy", policy);
    expect(designDifference(old, { ...old, resources: old.resources.map(r => r.id === "store" ? { ...r, objectStoragePolicy: policy } : r) }).reconfigured[0]!.fields).toEqual([{ field: "objectStoragePolicy", earlier: null, later: policy }]);
  }
});

test("invalid object capacity refuses layout/live/readiness/capture", () => {
  for (const policy of [null, {}, { version: 2, capacityMiB: 1 }, { version: 1, capacityMiB: 0 }, { version: 1, capacityMiB: 1.5 }, { version: 1, capacityMiB: 8589934592 }, { version: 1, capacityMiB: 1, extra: true }]) {
    const layout = capacityLayout(); Object.assign(layout.resources[3]!, { objectStoragePolicy: policy });
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.some(e => e.startsWith("store:"))).toBe(true);
    expect(() => captureRunInputs(layout, capacityWorkload)).toThrow();
  }
  const wrong = capacityLayout(); wrong.resources[0]!.objectStoragePolicy = { version: 1, capacityMiB: 1 };
  for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(wrong).success).toBe(false);
});
