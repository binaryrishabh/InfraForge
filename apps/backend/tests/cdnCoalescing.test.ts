import { expect, test } from "bun:test";
import type { AdapterProfile } from "@infraforge/contracts/run-inputs";
import type { CdnCachePolicy } from "@infraforge/domain/resource";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { cdnLayout, cdnWorkload } from "./cdnTtl.fixture";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration, designDifference } from "../comparison/design";

for (const coalesce of [true, false]) for (const ttlSeconds of [undefined, 1, 3600]) test(`v2 boundary capture and replay: ${coalesce}/${ttlSeconds}`, () => {
  const layout = cdnLayout(), policy: CdnCachePolicy = { version: 2, coalesce, ...(coalesce ? { maxWaiters: 3 } : {}), ...(ttlSeconds === undefined ? {} : { ttlSeconds }) };
  layout.resources[0]!.cdnCachePolicy = policy;
  for (const schema of [LayoutSchema, LiveTopologySchema]) expect(layout.resources).toEqual(schema.parse(layout).resources);
  expect(validateDeploymentReadiness(layout.resources, layout.connectionLines)).toEqual(validateDeploymentReadiness(cdnLayout().resources, layout.connectionLines));
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, cdnWorkload, "cdn-coalescing"))));
  const profiles: AdapterProfile[] = [...(ttlSeconds === undefined ? [] : ["cdn-ttl/1" as const]), "cdn-coalescing/1"];
  expect(input.adapterProfiles).toEqual(profiles);
  expect(buildContractFromRunInputs(input, 12)).not.toHaveProperty("refused");
  for (const adapterProfiles of [undefined, [], ["cdn-ttl/1"]] as (AdapterProfile[] | undefined)[]) expect(buildContractFromRunInputs({ ...input, adapterProfiles }, 12)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...input, adapterProfiles: ["cdn-coalescing/1", "cdn-coalescing/1"] })).toThrow();
  expect(configuration(layout.resources[0]!)).toHaveProperty("cdnCachePolicy", policy);
  expect(designDifference(cdnLayout(), layout).reconfigured[0]!.fields).toEqual([{ field: "cdnCachePolicy", earlier: null, later: policy }]);
});

test("malformed v2 policies and wrong owners refuse layout, live and readiness", () => {
  for (const policy of [{ version: 2 }, { version: 2, coalesce: "On" }, { version: 2, coalesce: false, maxWaiters: 2 }, { version: 2, coalesce: true, extra: 1 }, ...[0, 100001, 1.5, null, "3"].map(maxWaiters => ({ version: 2, coalesce: true, maxWaiters }))]) {
    const layout = cdnLayout(); Object.assign(layout.resources[0]!, { cdnCachePolicy: policy });
    for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
    expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.some(e => e.startsWith(`${layout.resources[0]!.id}:`))).toBe(true);
  }
  const layout = cdnLayout(); layout.resources[1]!.cdnCachePolicy = { version: 2, coalesce: true };
  for (const schema of [LayoutSchema, LiveTopologySchema]) expect(schema.safeParse(layout).success).toBe(false);
  expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.some(e => e.startsWith("store:"))).toBe(true);
});
