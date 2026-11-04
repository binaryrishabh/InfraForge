import { expect, test } from "bun:test";
import type { LbSelection, Resource } from "@infraforge/domain/resource";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { compareInputs } from "../comparison/inputs";

const workload = { targetThroughput: 12000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
export function selectionLayout(policy?: LbSelection["policy"]) {
  const resources: Resource[] = [
    { id: "lb", type: "Load Balancer", x: 0, y: 0, ...(policy ? { lbSelection: { version: 1 as const, policy } } : {}) },
    { id: "slow", type: "Virtual Machine", x: 1, y: 0, vmCpuQuota: { version: 1, limitPercent: 1 } },
    { id: "fast", type: "Virtual Machine", x: 2, y: 0, size: "large" },
  ];
  return { resources, connectionLines: ["slow", "fast"].map(id => ({ id: `to-${id}`, sourceId: "lb", sourceType: "Load Balancer", targetId: id, targetType: "Virtual Machine", port: 80 })) };
}

test("layout/live/captured schemas preserve selection, reject malformed settings and wrong ownership", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const policy of ["round-robin", "least-outstanding"] as const) {
      const parsed = schema.parse(selectionLayout(policy));
      expect(readRunInputs(captureRunInputs(parsed, workload, "selection")).resources[0]!.lbSelection).toEqual({ version: 1, policy });
    }
    for (const value of [null, [], {}, { version: 1 }, { version: 2, policy: "round-robin" }, { version: 1, policy: "random" }, { version: 1, policy: "round-robin", weight: 1 }]) {
      const d = selectionLayout(); Object.assign(d.resources[0]!, { lbSelection: value });
      expect(schema.safeParse(d).success).toBe(false); expect(() => captureRunInputs(d, workload, "bad")).toThrow();
    }
    const d = selectionLayout(); d.resources[1]!.lbSelection = { version: 1, policy: "round-robin" };
    expect(schema.safeParse(d).success).toBe(false);
  }
});

test("only new explicit selection captures the profile, old and inconsistent captures refuse", () => {
  const legacy = selectionLayout(); delete legacy.resources[1]!.vmCpuQuota;
  const old = captureRunInputs(legacy, workload, "selection");
  expect(old.adapterProfiles).not.toContain("lb-selection/1"); expect(old.resources[0]).not.toHaveProperty("lbSelection");
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: undefined }, 3)).toHaveProperty("contract");
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: ["lb-selection/1"] }, 3)).toHaveProperty("refused");
  for (const policy of ["round-robin", "least-outstanding"] as const) {
    const input = captureRunInputs(selectionLayout(policy), workload, "selection"), saved = readRunInputs(JSON.parse(JSON.stringify(input)));
    expect(saved).toEqual(input); expect(saved.adapterProfiles).toContain("lb-selection/1");
    expect(buildContractFromRunInputs(saved, 3)).toHaveProperty("contract");
    for (const adapterProfiles of [undefined, []]) expect(buildContractFromRunInputs({ ...saved, adapterProfiles }, 3)).toHaveProperty("refused");
    expect(() => readRunInputs({ ...saved, adapterProfiles: ["lb-selection/1", "lb-selection/1"] })).toThrow();
  }
  const a = captureRunInputs(selectionLayout("round-robin"), workload, "same"), b = captureRunInputs(selectionLayout("least-outstanding"), workload, "same");
  expect(compareInputs(a, b)).toMatchObject({ grade: "one-change-design", design: { reconfigured: [{ id: "lb", fields: [{ field: "lbSelection" }] }] } });
});
