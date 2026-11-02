import { expect, test } from "bun:test";
import type { LbHealth, Resource } from "@infraforge/domain/resource";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { compareInputs } from "../comparison/inputs";

const workload = { targetThroughput: 72000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
function layout(lbHealth?: LbHealth) {
  const resources: Resource[] = [{ id: "lb", type: "Load Balancer", x: 0, y: 0, ...(lbHealth ? { lbHealth } : {}) }, { id: "app", type: "Virtual Machine", x: 1, y: 0, size: "large" }];
  return { resources, connectionLines: [{ id: "backend", sourceId: "lb", sourceType: "Load Balancer", targetId: "app", targetType: "Virtual Machine", port: 80 }] };
}
const controls: LbHealth[] = [{ version: 1, intervalSeconds: 1 }, { version: 1, timeoutSeconds: 2 }, { version: 1, unhealthyAfter: 2 }, { version: 1, healthyAfter: 2 }, { version: 1, intervalSeconds: 60, timeoutSeconds: 60, unhealthyAfter: 10, healthyAfter: 10 }];

test("layout/live/captured schemas preserve partial health policy and refuse malformed or overlapping checks", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const setting of [{ version: 1 as const }, ...controls]) {
      const parsed = schema.parse(JSON.parse(JSON.stringify(layout(setting))));
      expect(parsed.resources[0]!.lbHealth).toEqual(setting);
      expect(readRunInputs(captureRunInputs(parsed, workload, "lb-health-schema")).resources[0]!.lbHealth).toEqual(setting);
    }
    const invalid: unknown[] = [null, [], {}, { version: 2 }, { version: 1, provider: true }, { version: 1, timeoutSeconds: 6 }, { version: 1, intervalSeconds: 1, timeoutSeconds: 2 }];
    for (const [field, max] of [["intervalSeconds", 60], ["timeoutSeconds", 60], ["unhealthyAfter", 10], ["healthyAfter", 10]] as const) for (const n of [0, -1, 1.5, max + 1, null, "1", NaN, Infinity]) invalid.push({ version: 1, [field]: n });
    for (const value of invalid) {
      const d = layout(); Object.assign(d.resources[0]!, { lbHealth: value });
      expect(schema.safeParse(d).success).toBe(false); expect(() => captureRunInputs(d, workload, "bad-health")).toThrow();
    }
    const wrong = layout(); wrong.resources[1]!.lbHealth = { version: 1 };
    expect(schema.safeParse(wrong).success).toBe(false);
  }
});

test("only new explicit health intent captures a profile; historical, missing, duplicate and mismatched profiles refuse", () => {
  for (const setting of [undefined, { version: 1 as const }]) {
    const old = captureRunInputs(layout(setting), workload, "health-capture"); expect(old.adapterProfiles).toEqual(["traffic-evidence/2"]);
    expect(buildContractFromRunInputs({ ...old, adapterProfiles: undefined }, 3)).toHaveProperty("contract");
    expect(buildContractFromRunInputs({ ...old, adapterProfiles: ["lb-health/1"] }, 3)).toHaveProperty("refused");
  }
  for (const setting of controls) {
    const input = captureRunInputs(layout(setting), workload, "health-capture"), saved = readRunInputs(JSON.parse(JSON.stringify(input)));
    expect(saved).toEqual(input); expect(saved.adapterProfiles).toEqual(["lb-health/1", "traffic-evidence/2"]);
    expect(buildContractFromRunInputs(saved, 3)).toHaveProperty("contract");
    for (const adapterProfiles of [undefined, []]) expect(buildContractFromRunInputs({ ...saved, adapterProfiles }, 3)).toHaveProperty("refused");
    expect(() => readRunInputs({ ...saved, adapterProfiles: ["lb-health/1", "lb-health/1"] })).toThrow();
  }
  const combined = layout(controls[0]); combined.resources[0]!.lbAdmission = { version: 1, maxActive: 8 };
  const input = captureRunInputs(combined, workload, "both");
  expect(input.adapterProfiles).toEqual(["lb-admission/1", "lb-health/1", "traffic-evidence/2"]);
  expect(buildContractFromRunInputs(readRunInputs(input), 3)).toHaveProperty("contract");
});

test("each health control is retained as one design change, with absence kept absent", () => {
  const old = captureRunInputs(layout(), workload, "same");
  expect(old.resources[0]).not.toHaveProperty("lbHealth");
  const base = { version: 1 as const, intervalSeconds: 5, timeoutSeconds: 1, unhealthyAfter: 1, healthyAfter: 1 };
  const a = captureRunInputs(layout(base), workload, "same");
  for (const setting of controls) {
    const b = captureRunInputs(layout(setting), workload, "same");
    expect(compareInputs(a, b)).toMatchObject({ grade: "one-change-design", design: { reconfigured: [{ id: "lb", fields: [{ field: "lbHealth" }] }] } });
    expect(compareInputs(old, b).grade).toBe("side-by-side-only");
  }
});
