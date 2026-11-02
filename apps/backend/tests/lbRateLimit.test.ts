import { expect, test } from "bun:test";
import { lbRateLimitError } from "@infraforge/domain/resource";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { compareInputs } from "../comparison/inputs";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { layout, workload } from "./integration/scenario";

test("LB limiter strictly captures explicit bounded intent, preserves old absence and comparison", () => {
  const old = captureRunInputs(layout, workload, "lb-rate-limit");
  const design = structuredClone(layout), lb = design.resources.find(r => r.type === "Load Balancer")!;
  lb.lbRateLimit = { version: 1, burstRequests: 10, sustainedRequestsPerSecond: 25.5 };
  expect(lbRateLimitError(lb.type, lb.lbRateLimit)).toBeUndefined();
  expect(LayoutSchema.safeParse(design).success).toBe(true); expect(LiveTopologySchema.safeParse(design).success).toBe(true);
  const captured = captureRunInputs(design, workload, old.seed);
  expect(captured.adapterProfiles).toContain("lb-rate-limit/1"); expect(captured.adapterProfiles).toContain("failure-cause/1");
  expect(old.adapterProfiles).not.toContain("lb-rate-limit/1");
  expect(readRunInputs(JSON.parse(JSON.stringify(captured)))).toEqual(captured);
  expect(compareInputs(old, captured).facets.topology).toBe("different");
  expect("refused" in buildContractFromRunInputs(captured, 2)).toBe(false);
  for (const adapterProfiles of [[], ["failure-cause/1" as const], [...captured.adapterProfiles!, "lb-rate-limit/1" as const]]) expect("refused" in buildContractFromRunInputs({ ...captured, adapterProfiles }, 2)).toBe(true);
  expect("refused" in buildContractFromRunInputs({ ...old, adapterProfiles: ["lb-rate-limit/1"] }, 2)).toBe(true);
});

test("malformed, unbounded, wrong-owner and unknown limiter settings are refused", () => {
  const good = { version: 1, burstRequests: 1, sustainedRequestsPerSecond: 1 };
  for (const v of [null, {}, { ...good, version: 2 }, { ...good, burstRequests: 0 }, { ...good, burstRequests: 1.5 }, { ...good, burstRequests: 100001 },
    ...[0, NaN, Infinity, 0.0001, 1000001].map(sustainedRequestsPerSecond => ({ ...good, sustainedRequestsPerSecond })), { ...good, extra: true }]) {
    expect(lbRateLimitError("Load Balancer", v)).toBeDefined();
    const d = structuredClone(layout); Object.assign(d.resources.find(r => r.type === "Load Balancer")!, { lbRateLimit: v });
    expect(LayoutSchema.safeParse(d).success).toBe(false);
  }
  expect(lbRateLimitError("Virtual Machine", good)).toBeDefined(); expect(lbRateLimitError("Load Balancer", undefined)).toBeUndefined();
});
