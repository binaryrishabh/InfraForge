import { expect, test } from "bun:test";
import { clientRetryError } from "@infraforge/domain/workload";
import { compileProduct, contractFromDesign } from "@infraforge/simulation/internal-product";
import { WorkloadProfileSchema } from "../zod_schemas/deployment.schema";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { currentDesignInput } from "../reruns/options";
import { readRecords } from "../reports/records";
import { compareInputs } from "../comparison/inputs";
import { layout, workload } from "./integration/scenario";

const policy = { version: 1 as const, maxAttempts: 3, backoffMs: 50, attemptTimeoutMs: 100 };
test("attempt timeout survives capture, JSON, report, rerun and comparison in the same profile", () => {
  const old = captureRunInputs(layout, { ...workload, clientRetry: { version: 1, maxAttempts: 3, backoffMs: 50 } }, "timeout");
  const input = captureRunInputs(layout, { ...workload, clientRetry: policy }, old.seed);
  expect(WorkloadProfileSchema.parse(input.workloadProfile).clientRetry).toEqual(policy);
  expect(readRunInputs(JSON.parse(JSON.stringify(input)))).toEqual(input);
  expect(currentDesignInput(input, layout).workloadProfile.clientRetry).toEqual(policy);
  expect(readRecords({ runInputs: input, stages: [], timeline: [], chaosEvents: [] }, []).input!.workloadProfile.clientRetry).toEqual(policy);
  expect(input.adapterProfiles).toEqual(old.adapterProfiles);
  expect(compareInputs(old, input)).toMatchObject({ grade: "one-change-workload", facets: { workload: "different" } });
  expect(compareInputs(old, input).workload).toContainEqual(expect.objectContaining({ field: "clientRetry" }));
});

test("attempt timeout is optional, strict, bounded integer intent inside retries", () => {
  for (const attemptTimeoutMs of [0, 60001, 1.5, NaN, Infinity, null, "100"]) {
    const value = { ...policy, attemptTimeoutMs };
    expect(clientRetryError(value)).not.toBeNull();
    expect(WorkloadProfileSchema.safeParse({ ...workload, clientRetry: value }).success).toBe(false);
  }
  for (const attemptTimeoutMs of [1, 60000]) {
    expect(clientRetryError({ ...policy, attemptTimeoutMs })).toBeNull();
    expect(WorkloadProfileSchema.parse({ ...workload, clientRetry: { ...policy, attemptTimeoutMs } }).clientRetry!.attemptTimeoutMs).toBe(attemptTimeoutMs);
  }
  expect(WorkloadProfileSchema.safeParse({ ...workload, attemptTimeoutMs: 100 }).success).toBe(false);
});

test("compiler refuses mismatched timeout and timeout at or beyond the read root deadline", () => {
  const input = captureRunInputs(layout, { ...workload, clientRetry: policy }, "timeout-compile");
  const design = { schema: "infraforge-saved-design/1" as const, resources: input.resources, connections: input.connectionLines, workload: input.workloadProfile };
  const b = contractFromDesign(design); if ("refused" in b) throw Error(JSON.stringify(b));
  expect(compileProduct(design, b.contract).ok).toBe(true);
  b.contract.clientRetry!.attemptTimeoutMs = 101;
  expect(compileProduct(design, b.contract).ok).toBe(false);
  b.contract.clientRetry!.attemptTimeoutMs = 100;
  const read = b.contract.application!.operations.find(o => o.id === b.contract.application!.readOperation)!;
  if (read.callerTimeout.kind !== "known") throw Error("Expected explicit caller timeout");
  for (const ms of [read.callerTimeout.value / 1000, read.callerTimeout.value / 1000 + 1]) {
    const d = { ...design, workload: { ...design.workload, clientRetry: { ...policy, attemptTimeoutMs: ms } } };
    b.contract.clientRetry!.attemptTimeoutMs = ms;
    const c = compileProduct(d, b.contract);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(JSON.stringify(c.diagnostics)).toContain("attempt timeout must be less than");
  }
});
