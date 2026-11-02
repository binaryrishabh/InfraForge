import { expect, test } from "bun:test";
import { resolveWorkload, workloadObjectiveError } from "@infraforge/domain/workload";
import { compileProduct, contractFromDesign } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { WorkloadProfileSchema } from "../zod_schemas/deployment.schema";
import { currentDesignInput } from "../reruns/options";
import { readRecords } from "../reports/records";
import { compareInputs } from "../comparison/inputs";
import { layout, workload } from "./integration/scenario";

const workloadObjective = { version: 1 as const, maxResponseMs: 250, targetSuccessPercent: 99.9 };
test("objective survives capture, JSON, report facts, rerun and comparison without an adapter", () => {
  const old = captureRunInputs(layout, workload, "objective-capture");
  expect(resolveWorkload(workload)).not.toHaveProperty("workloadObjective");
  const captured = captureRunInputs(layout, { ...workload, workloadObjective }, old.seed);
  expect(captured.adapterProfiles).toEqual(old.adapterProfiles);
  expect(captured.workloadProfile.workloadObjective).toEqual(workloadObjective);
  expect(readRunInputs(JSON.parse(JSON.stringify(captured)))).toEqual(captured);
  expect(currentDesignInput(captured, layout).workloadProfile).toEqual(captured.workloadProfile);
  const report = readRecords({ runInputs: captured, workloadProfile: captured.workloadProfile, stages: [], timeline: [], chaosEvents: [] }, []);
  expect(report.input!.workloadProfile.workloadObjective).toEqual(workloadObjective);
  expect(report.legacyWorkload!.workloadObjective).toEqual(workloadObjective);
  expect(compareInputs(old, captured).facets.workload).toBe("different");
  expect(compareInputs(captured, readRunInputs(JSON.parse(JSON.stringify(captured)))).facets.workload).toBe("same");
});

test("strict bounded objective validation agrees at capture, reading and readiness", () => {
  for (const value of [null, {}, { ...workloadObjective, version: 2 }, { ...workloadObjective, period: 10 },
    ...[0, 60001, 1.5, NaN, Infinity].map(maxResponseMs => ({ ...workloadObjective, maxResponseMs })),
    ...[49.99, 100, NaN, Infinity].map(targetSuccessPercent => ({ ...workloadObjective, targetSuccessPercent }))]) {
    const profile = { ...workload, workloadObjective: value };
    expect(WorkloadProfileSchema.safeParse(profile).success).toBe(false);
    expect(workloadObjectiveError(value)).not.toBeNull();
    expect(() => readRunInputs({ ...captureRunInputs(layout, workload, "invalid"), workloadProfile: profile })).toThrow();
    const design = { schema: "infraforge-saved-design/1" as const, resources: layout.resources, connections: layout.connectionLines, workload: profile };
    expect(contractFromDesign(design as never)).toHaveProperty("refused");
  }
  for (const targetSuccessPercent of [50, 90, 99.9, 99.99, 95.123456789]) {
    const value = { ...workloadObjective, targetSuccessPercent };
    expect(workloadObjectiveError(value)).toBeNull();
    expect(WorkloadProfileSchema.parse({ ...workload, workloadObjective: value }).workloadObjective).toEqual(value);
  }
});

test("compilation preserves objective intent and refuses a mismatched captured contract", () => {
  const design = { schema: "infraforge-saved-design/1" as const, resources: layout.resources, connections: layout.connectionLines, workload: { ...workload, workloadObjective } };
  const built = contractFromDesign(design); if ("refused" in built) throw Error(JSON.stringify(built));
  expect(built.contract.workloadObjective).toEqual(workloadObjective);
  const c = compileProduct(design, built.contract); if (!c.ok) throw Error(JSON.stringify(c));
  expect(c.value.input.workloadObjective).toEqual(workloadObjective);
  built.contract.workloadObjective!.maxResponseMs++;
  expect(compileProduct(design, built.contract).ok).toBe(false);
  delete built.contract.workloadObjective;
  expect(compileProduct(design, built.contract).ok).toBe(false);
});
