import { expect, test } from "bun:test";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { compareInputs } from "../comparison/inputs";

const workload = { targetThroughput: 36000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
const memory = { version: 1 as const, baselineMiB: 256, requestMiB: 32, activeMiB: 16 };
const layout = (enabled = true) => ({ resources: [{ id: "app", type: "Virtual Machine" as const, x: 0, y: 0, ...(enabled ? { vmMemory: memory } : {}) }], connectionLines: [] });

test("memory survives strict layout/live, serialization and replay capture", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    const parsed = schema.parse(layout());
    expect(parsed.resources[0]).toHaveProperty("vmMemory", memory);
    const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(parsed, workload, "memory"))));
    expect(input.resources[0]).toHaveProperty("vmMemory", memory);
    expect(buildContractFromRunInputs(input, 3)).toHaveProperty("contract");
  }
});
test("memory capture selects only explicit intent and refuses missing/duplicate/mismatched selection", () => {
  const old = captureRunInputs(layout(false), workload, "memory"), saved = captureRunInputs(layout(), workload, "memory");
  expect(old.adapterProfiles).toEqual(["traffic-evidence/2"]);
  expect(saved.adapterProfiles).toContain("vm-memory/1");
  for (const adapterProfiles of [undefined, [], ["traffic-evidence/2" as const]]) expect(buildContractFromRunInputs({ ...saved, adapterProfiles }, 3)).toHaveProperty("refused");
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: saved.adapterProfiles }, 3)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...saved, adapterProfiles: [...saved.adapterProfiles!, ...saved.adapterProfiles!] })).toThrow();
  const next = layout(); next.resources[0]!.vmMemory = { ...memory, requestMiB: 64 };
  expect(compareInputs(saved, captureRunInputs(next, workload, "memory"))).toMatchObject({ grade: "one-change-design", design: { reconfigured: [{ id: "app", fields: [{ field: "vmMemory" }] }] } });
});
test("layout/live reject wrong owners, zero growth, unknown keys and malformed amounts", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const value of [null, {}, { ...memory, version: 2 }, { ...memory, extra: 1 }, { ...memory, requestMiB: 0, activeMiB: 0 },
      ...[-1, 1048577, 1.5, "1", null].map(requestMiB => ({ ...memory, requestMiB }))]) {
      const d = layout(false); Object.assign(d.resources[0]!, { vmMemory: value }); expect(schema.safeParse(d).success).toBe(false);
    }
    for (const patch of [{ type: "Database" }, { asyncWorker: { enabled: true } }]) {
      const d = layout(); Object.assign(d.resources[0]!, patch); expect(schema.safeParse(d).success).toBe(false);
    }
  }
});
