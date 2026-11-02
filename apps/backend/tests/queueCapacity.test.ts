import { expect, test } from "bun:test";
import { DEFAULT_ASYNC_QUEUE_SETTINGS, type Resource } from "@infraforge/domain/resource";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { compareInputs } from "../comparison/inputs";
import { capacityLayout, capacityWorkload as workload } from "./queueCapacity.fixture";

test("queue capacity survives save/reload, live validation and captured inputs without default injection", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) for (const value of [undefined, 1, 100000]) {
    const saved = JSON.parse(JSON.stringify(schema.parse(capacityLayout(value))));
    const input = readRunInputs(captureRunInputs(saved, workload, "capacity"));
    expect(input.resources.find(r => r.id === "queue")!.asyncQueue!.capacityMessages).toBe(value);
    expect(input.adapterProfiles).toEqual([...(value === undefined ? [] : ["queue-capacity/1"]), "traffic-evidence/2"]);
    expect(buildContractFromRunInputs(input, 3)).toHaveProperty("contract");
  }
  expect(DEFAULT_ASYNC_QUEUE_SETTINGS).not.toHaveProperty("capacityMessages");
});

test("reconstruction refuses missing, mismatched and duplicate captured capacity profiles", () => {
  const input = captureRunInputs(capacityLayout(3), workload, "capacity"), old = captureRunInputs(capacityLayout(), workload, "capacity");
  for (const adapterProfiles of [undefined, [], ["vm-execution/1" as const]]) expect(buildContractFromRunInputs({ ...input, adapterProfiles }, 3)).toHaveProperty("refused");
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: input.adapterProfiles }, 3)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...input, adapterProfiles: ["queue-capacity/1", "queue-capacity/1"] })).toThrow();
  const combined = captureRunInputs(capacityLayout(3, true), workload, "capacity");
  expect(combined.adapterProfiles).toEqual(["failure-cause/1", "application-flow/3", "queue-capacity/1", "traffic-evidence/2"]);
  expect(buildContractFromRunInputs(combined, 3)).toHaveProperty("contract");
  expect(compareInputs(input, captureRunInputs(capacityLayout(4), workload, "capacity"))).toMatchObject({ grade: "one-change-design", design: { reconfigured: [{ id: "queue", fields: [{ field: "asyncQueue" }] }] } });
});

test("layout/live reject invalid capacity, wrong owners and unrecognized async fields", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const capacityMessages of [0, -1, 100001, 1.5, "3", null, NaN, Infinity]) {
      const d = capacityLayout(); Object.assign(d.resources.find(r => r.id === "queue")!.asyncQueue!, { capacityMessages });
      expect(schema.safeParse(d).success).toBe(false);
    }
    for (const type of ["Virtual Machine", "Database", "Object Storage"] as Resource["type"][]) {
      const d = capacityLayout(3); d.resources.find(r => r.id === "queue")!.type = type;
      expect(schema.safeParse(d).success).toBe(false);
    }
    const extra = capacityLayout(3); Object.assign(extra.resources.find(r => r.id === "queue")!.asyncQueue!, { capacityBytes: 1 });
    expect(schema.safeParse(extra).success).toBe(false);
  }
});
