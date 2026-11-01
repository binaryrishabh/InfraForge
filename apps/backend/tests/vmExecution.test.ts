import { expect, test } from "bun:test";
import type { Resource, VmExecution } from "@infraforge/domain/resource";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { compareInputs } from "../comparison/inputs";

function layout(vmExecution?: VmExecution) {
  const resources: Resource[] = [{ id: "app", type: "Virtual Machine", x: 0, y: 0, ...(vmExecution ? { vmExecution } : {}) }, { id: "db", type: "Database", x: 1, y: 0 }];
  return { resources, connectionLines: [{ id: "app-db", sourceId: "app", sourceType: "Virtual Machine", targetId: "db", targetType: "Database", port: 5432 }] };
}
const workload = { targetThroughput: 72000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };

test("layout/live/captured schemas preserve partial bounded execution limits and reject malformed intent", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const vmExecution of [{ version: 1 as const }, { version: 1 as const, workers: 1 }, { version: 1 as const, queuedRequests: 0 }, { version: 1 as const, workers: 512, queuedRequests: 1000 }]) {
      const parsed = schema.parse(JSON.parse(JSON.stringify(layout(vmExecution))));
      expect(parsed.resources[0]!.vmExecution).toEqual(vmExecution);
      expect(readRunInputs(captureRunInputs(parsed, workload, "vm-schema")).resources[0]!.vmExecution).toEqual(vmExecution);
    }
    for (const value of [null, [], {}, { version: 2 }, { version: 1, sessions: 10 }, ...[0, -1, 1.5, 513, null, "1", NaN, Infinity].map(workers => ({ version: 1, workers })), ...[-1, 1.5, 1001, null, "1", NaN, Infinity].map(queuedRequests => ({ version: 1, queuedRequests }))]) {
      const d = layout(); Object.assign(d.resources[0]!, { vmExecution: value });
      expect(schema.safeParse(d).success).toBe(false); expect(() => captureRunInputs(d, workload, "bad-vm-limit")).toThrow();
    }
    const wrongOwner = layout(); wrongOwner.resources[1]!.vmExecution = { version: 1, workers: 1 };
    expect(schema.safeParse(wrongOwner).success).toBe(false);
  }
});

test("capture opts in only for explicit VM limits; missing, duplicate and mismatched profiles refuse", () => {
  const old = captureRunInputs(layout(), workload, "vm-capture"); expect(old.adapterProfiles).toEqual([]);
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: [...old.adapterProfiles!, "vm-execution/1"] }, 5)).toHaveProperty("refused");
  for (const setting of [{ version: 1 as const, workers: 1 }, { version: 1 as const, queuedRequests: 0 }, { version: 1 as const, workers: 8, queuedRequests: 2 }]) {
    const captured = captureRunInputs(layout(setting), workload, "vm-capture"), saved = readRunInputs(JSON.parse(JSON.stringify(captured)));
    expect(saved).toEqual(captured); expect(saved.adapterProfiles).toContain("vm-execution/1");
    expect(buildContractFromRunInputs(saved, 5)).toHaveProperty("contract");
    for (const adapterProfiles of [undefined, [], ["lb-admission/1" as const]]) expect(buildContractFromRunInputs({ ...saved, adapterProfiles }, 5)).toHaveProperty("refused");
    expect(() => readRunInputs({ ...saved, adapterProfiles: [...saved.adapterProfiles!, "vm-execution/1"] })).toThrow();
  }
});

test("async-worker layout, live and captured input refuse execution intent", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    const d = layout({ version: 1, workers: 1 });
    d.resources[0]!.asyncWorker = { enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 250 };
    expect(schema.safeParse(d).success).toBe(false);
    expect(() => captureRunInputs(d, workload, "async-refusal")).toThrow();
  }
});

test("saved VM limits remain visible in one-change comparisons and absence stays absent", () => {
  const a = captureRunInputs(layout({ version: 1, workers: 1, queuedRequests: 2 }), workload, "same"), b = captureRunInputs(layout({ version: 1, workers: 8, queuedRequests: 2 }), workload, "same");
  expect(compareInputs(a, b)).toMatchObject({ grade: "one-change-design", design: { reconfigured: [{ id: "app", fields: [{ field: "vmExecution" }] }] } });
  expect(captureRunInputs(layout(), workload, "old").resources[0]).not.toHaveProperty("vmExecution");
});
