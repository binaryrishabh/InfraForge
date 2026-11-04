import { expect, test } from "bun:test";
import type { Resource } from "@infraforge/domain/resource";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { dnsLayout, dnsWorkload } from "./dnsDepth.fixture";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { configuration, designDifference } from "../comparison/design";

for (const ttl of [undefined, 1, 60, 3600]) test(`strict TTL capture, replay and comparison: ${ttl}`, () => {
  const layout = dnsLayout(ttl);
  expect(layout.resources).toEqual(LayoutSchema.parse(layout).resources);
  expect(layout.resources).toEqual(LiveTopologySchema.parse(layout).resources);
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout, dnsWorkload, "dns-depth"))));
  expect(input.adapterProfiles).toEqual([...(ttl === undefined ? [] : ["dns-cache/1" as const]), "traffic-evidence/2"]);
  expect(buildContractFromRunInputs(input, 12)).not.toHaveProperty("refused");
  expect(configuration(layout.resources[0]!)).toEqual(expect.objectContaining(ttl === undefined ? {} : { dnsCachePolicy: { version: 1, maxTtlSeconds: ttl } }));
  if (ttl === undefined) expect(configuration(layout.resources[0]!)).not.toHaveProperty("dnsCachePolicy");
  else for (const adapterProfiles of [undefined, []]) expect(buildContractFromRunInputs({ ...input, adapterProfiles }, 12)).toHaveProperty("refused");
  if (ttl === undefined) {
    const old = { ...input }; delete old.adapterProfiles;
    expect(readRunInputs(old)).not.toHaveProperty("adapterProfiles");
    expect(buildContractFromRunInputs(old, 12)).toEqual(buildContractFromRunInputs({ ...input, adapterProfiles: [] }, 12));
  }
});

for (const policy of [null, [], 60, {}, { version: 1 }, { version: 2, maxTtlSeconds: 60 }, ...[0, -1, 3601, 1.5, "60", null, NaN, Infinity].map(maxTtlSeconds => ({ version: 1, maxTtlSeconds })), { version: 1, maxTtlSeconds: 60, coalesce: true }, { version: 1, maxTtlSeconds: 60, maxWaiters: 256 }]) test(`bad TTL intent refuses at every boundary: ${JSON.stringify(policy)}`, () => {
  const layout = dnsLayout(); Object.assign(layout.resources[0]!, { dnsCachePolicy: policy });
  expect(LayoutSchema.safeParse(layout).success).toBe(false); expect(LiveTopologySchema.safeParse(layout).success).toBe(false);
  expect(validateDeploymentReadiness(layout.resources, layout.connectionLines).errors.some(e => e.includes("DNS"))).toBe(true);
});

test("DNS policy rejects other owners and duplicate captured profiles; comparisons show explicit changes", () => {
  const layout = dnsLayout(60);
  const wrong = structuredClone(layout); Object.assign(wrong.resources[1]!, { dnsCachePolicy: { version: 1, maxTtlSeconds: 60 } });
  expect(LayoutSchema.safeParse(wrong).success).toBe(false);
  const input = captureRunInputs(layout, dnsWorkload, "dns-depth");
  expect(() => readRunInputs({ ...input, adapterProfiles: ["dns-cache/1", "dns-cache/1"] })).toThrow();
  const before = structuredClone(layout); delete (before.resources[0]! as Resource & { dnsCachePolicy?: unknown }).dnsCachePolicy;
  expect(designDifference(before, layout).reconfigured[0]!.fields).toEqual([{ field: "dnsCachePolicy", earlier: null, later: { version: 1, maxTtlSeconds: 60 } }]);
});
