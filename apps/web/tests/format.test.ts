import { expect, test } from "bun:test";
import { plural } from "../src/lib/format";

test("counts read naturally at one and at many", () => {
  expect(plural(1, "connection")).toBe("1 connection");
  expect(plural(0, "resource")).toBe("0 resources");
  expect(plural(3, "replica")).toBe("3 replicas");
  expect(plural(2, "proxy", "proxies")).toBe("2 proxies");
});

test("a preset is described by what it sets, not by every default it leaves alone", async () => {
  const { describeWorkloadBrief } = await import("../src/lib/format");
  const { WORKLOAD_PRESETS } = await import("../src/features/deployment/workloadOptions");
  const steady = describeWorkloadBrief(WORKLOAD_PRESETS[0]!.profile);
  expect(steady).toBe("1,000,000 requests per hour · steady · 80% reads · medium payloads");
  for (const noise of ["Even arrivals", "Fixed app CPU", "Client retries: none", "Service objective: none"]) expect(steady).not.toContain(noise);
  expect(describeWorkloadBrief(WORKLOAD_PRESETS[5]!.profile)).toBe("1,000,000 requests per hour · steady · 80% reads · medium payloads · Poisson arrivals · Variable app CPU: Moderate (CV 0.5)");
  const withRetry = { ...WORKLOAD_PRESETS[0]!.profile, clientRetry: { version: 1 as const, maxAttempts: 3, backoffMs: 200 }, workloadObjective: { version: 1 as const, maxResponseMs: 100, targetSuccessPercent: 95 } };
  expect(describeWorkloadBrief(withRetry)).toContain("Client retries: up to 3 attempts"); expect(describeWorkloadBrief(withRetry)).toContain("Service objective: 95% within 100 ms");
});
