import { expect, test } from "bun:test";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { compareInputs } from "../comparison/inputs";

const workload = { targetThroughput: 36000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
const layout = (limitPercent?: number) => ({ resources: [{ id: "app", type: "Virtual Machine" as const, x: 0, y: 0,
  ...(limitPercent === undefined ? {} : { vmCpuQuota: { version: 1 as const, limitPercent } }) }], connectionLines: [] });

test("learner-authored CPU quota survives layout/live and captured input", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) for (const percent of [1, 25, 100]) {
    const parsed = schema.parse(layout(percent));
    expect(parsed.resources[0]).toHaveProperty("vmCpuQuota", { version: 1, limitPercent: percent });
    expect(readRunInputs(captureRunInputs(parsed, workload, "quota")).resources[0]).toHaveProperty("vmCpuQuota", { version: 1, limitPercent: percent });
  }
});

test("quota capture is explicit, strict and composes with VM execution", () => {
  const old = captureRunInputs(layout(), workload, "quota");
  expect(old.adapterProfiles).toEqual([]);
  const saved = captureRunInputs(layout(25), workload, "quota");
  expect(saved.adapterProfiles).toEqual(["vm-cpu-quota/1"]);
  expect(buildContractFromRunInputs(saved, 3)).toHaveProperty("contract");
  for (const adapterProfiles of [undefined, [], ["vm-execution/1" as const]]) expect(buildContractFromRunInputs({ ...saved, adapterProfiles }, 3)).toHaveProperty("refused");
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: saved.adapterProfiles }, 3)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...saved, adapterProfiles: [...saved.adapterProfiles!, ...saved.adapterProfiles!] })).toThrow();
  const combined = layout(25); Object.assign(combined.resources[0]!, { vmExecution: { version: 1, workers: 4, queuedRequests: 32 } });
  expect(captureRunInputs(combined, workload, "quota").adapterProfiles).toEqual(["vm-execution/1", "vm-cpu-quota/1"]);
  expect(compareInputs(saved, captureRunInputs(layout(50), workload, "quota"))).toMatchObject({ grade: "one-change-design", design: { reconfigured: [{ id: "app", fields: [{ field: "vmCpuQuota" }] }] } });
});

test("layout/live reject malformed quota and wrong or async owners", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const value of [null, [], {}, { version: 2, limitPercent: 25 }, { version: 1, limitPercent: 25, periodMs: 100 }, ...[0, 101, -1, 1.5, "25", null, NaN, Infinity].map(limitPercent => ({ version: 1, limitPercent }))]) {
      const d = layout(); Object.assign(d.resources[0]!, { vmCpuQuota: value });
      expect(schema.safeParse(d).success).toBe(false);
    }
    const wrong = layout(25); Object.assign(wrong.resources[0]!, { type: "Database" }); expect(schema.safeParse(wrong).success).toBe(false);
    const async = layout(25); Object.assign(async.resources[0]!, { asyncWorker: { enabled: true } }); expect(schema.safeParse(async).success).toBe(false);
  }
});
