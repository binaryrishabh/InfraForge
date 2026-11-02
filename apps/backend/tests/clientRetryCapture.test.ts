import { expect, test } from "bun:test";
import { clientRetryError, resolveWorkload } from "@infraforge/domain/workload";
import { compileProduct, contractFromDesign } from "@infraforge/simulation/internal-product";
import { WorkloadProfileSchema } from "../zod_schemas/deployment.schema";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { currentDesignInput } from "../reruns/options";
import { readRecords } from "../reports/records";
import { compareInputs } from "../comparison/inputs";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { layout, workload } from "./integration/scenario";

const clientRetry = { version: 1 as const, maxAttempts: 3, backoffMs: 50 };
test("client retry intent survives capture, JSON, report, rerun and comparison; old captures stay absent", () => {
  const old = captureRunInputs(layout, workload, "retry-capture");
  expect(resolveWorkload(workload)).not.toHaveProperty("clientRetry");
  const captured = captureRunInputs(layout, { ...workload, clientRetry }, old.seed);
  expect(captured.workloadProfile).toHaveProperty("clientRetry", clientRetry);
  expect(captured.adapterProfiles).toContain("failure-cause/1");
  expect(captured.adapterProfiles).toContain("client-retry/1");
  expect(readRunInputs(JSON.parse(JSON.stringify(captured)))).toEqual(captured);
  expect(currentDesignInput(captured, layout).workloadProfile).toEqual(captured.workloadProfile);
  const report = readRecords({ runInputs: captured, workloadProfile: captured.workloadProfile, stages: [], timeline: [], chaosEvents: [] }, []);
  expect(report.input!.workloadProfile).toHaveProperty("clientRetry", clientRetry);
  expect(report.legacyWorkload).toHaveProperty("clientRetry", clientRetry);
  expect(compareInputs(old, captured).facets.workload).toBe("different");
  expect(compareInputs(captured, readRunInputs(JSON.parse(JSON.stringify(captured)))).facets.workload).toBe("same");
});

test("client retry schema rejects unknown, unbounded and fractional settings", () => {
  for (const value of [null, {}, { ...clientRetry, version: 2 }, { ...clientRetry, extra: true },
    ...[1, 5, 2.5, NaN, Infinity].map(maxAttempts => ({ ...clientRetry, maxAttempts })),
    ...[0, 10001, 1.5, NaN, Infinity].map(backoffMs => ({ ...clientRetry, backoffMs }))]) {
    expect(WorkloadProfileSchema.safeParse({ ...workload, clientRetry: value }).success).toBe(false);
    expect(clientRetryError(value)).not.toBeNull();
  }
  for (const maxAttempts of [2, 3, 4]) expect(WorkloadProfileSchema.parse({ ...workload, clientRetry: { ...clientRetry, maxAttempts } })).toHaveProperty("clientRetry.maxAttempts", maxAttempts);
});

test("client retries require captured matching profiles and compiled intent", () => {
  const captured = captureRunInputs(layout, { ...workload, clientRetry }, "retry-profiles");
  const design = { schema: "infraforge-saved-design/1" as const, resources: captured.resources, connections: captured.connectionLines, workload: captured.workloadProfile };
  for (const adapterProfiles of [[], ["client-retry/1" as const], ["failure-cause/1" as const], [...captured.adapterProfiles!, "client-retry/1" as const]]) {
    expect(buildModel2Contract(design, 3, captured.seed, adapterProfiles)).toHaveProperty("refused");
  }
  expect(contractFromDesign({ ...design, workload }, { adapterProfiles: captured.adapterProfiles! })).toHaveProperty("refused");
  const built = buildModel2Contract(design, 3, captured.seed, captured.adapterProfiles);
  if ("refused" in built) throw Error(JSON.stringify(built));
  expect(built.contract.clientRetry).toEqual(clientRetry);
  expect(compileProduct(design, built.contract).ok).toBe(true);
  built.contract.clientRetry!.backoffMs++;
  expect(compileProduct(design, built.contract).ok).toBe(false);
});
