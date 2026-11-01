import { expect, test } from "bun:test";
import type { Resource } from "@infraforge/domain/resource";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { cdnLayout, cdnWorkload } from "./cdnTtl.fixture";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration, designDifference } from "../comparison/design";

for (const ttl of [undefined, 1, 60, 3600]) test(`strict TTL capture, replay and comparison: ${ttl}`, () => {
  const layout = cdnLayout(ttl);
  expect(LayoutSchema.parse(layout).resources).toEqual(layout.resources);
  expect(LiveTopologySchema.parse(layout).resources).toEqual(layout.resources);
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, cdnWorkload, "cdn-ttl"))));
  expect(input.adapterProfiles).toEqual(ttl === undefined ? [] : ["cdn-ttl/1"]);
  expect(buildContractFromRunInputs(input, 12)).not.toHaveProperty("refused");
  expect(configuration(layout.resources[0]!)).toEqual(expect.objectContaining(ttl === undefined ? {} : { cdnCachePolicy: { version: 1, ttlSeconds: ttl } }));
  if (ttl === undefined) expect(configuration(layout.resources[0]!)).not.toHaveProperty("cdnCachePolicy");
  else for (const adapterProfiles of [undefined, []]) expect(buildContractFromRunInputs({ ...input, adapterProfiles }, 12)).toHaveProperty("refused");
});

for (const policy of [null, [], 60, {}, { version: 1 }, { version: 2, ttlSeconds: 60 }, ...[0, -1, 3601, 1.5, "60", null, NaN, Infinity].map(ttlSeconds => ({ version: 1, ttlSeconds })), { version: 1, ttlSeconds: 60, coalesce: true }, { version: 1, ttlSeconds: 60, maxWaiters: 256 }]) test(`bad TTL intent refuses at every boundary: ${JSON.stringify(policy)}`, () => {
  const layout = cdnLayout(); Object.assign(layout.resources[0]!, { cdnCachePolicy: policy });
  expect(LayoutSchema.safeParse(layout).success).toBe(false); expect(LiveTopologySchema.safeParse(layout).success).toBe(false);
  expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.some(e => e.includes("TTL"))).toBe(true);
});

test("CDN policy rejects other owners and duplicate captured profiles; comparisons show explicit changes", () => {
  const layout = cdnLayout(60);
  const wrong = structuredClone(layout); Object.assign(wrong.resources[1]!, { cdnCachePolicy: { version: 1, ttlSeconds: 60 } });
  expect(LayoutSchema.safeParse(wrong).success).toBe(false);
  const input = captureRunInputs(layout, cdnWorkload, "cdn-ttl");
  expect(() => readRunInputs({ ...input, adapterProfiles: ["cdn-ttl/1", "cdn-ttl/1"] })).toThrow();
  const before = structuredClone(layout); delete (before.resources[0]! as Resource & { cdnCachePolicy?: unknown }).cdnCachePolicy;
  expect(designDifference(before, layout).reconfigured[0]!.fields).toEqual([{ field: "cdnCachePolicy", earlier: null, later: { version: 1, ttlSeconds: 60 } }]);
});
