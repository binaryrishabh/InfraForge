import { expect, test } from "bun:test";
import { resolveWorkload, workloadDynamicsError } from "@infraforge/domain/workload";
import { WorkloadProfileSchema } from "../zod_schemas/deployment.schema";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { currentDesignInput } from "../reruns/options";
import { readRecords } from "../reports/records";
import { compareInputs } from "../comparison/inputs";
import { layout, workload } from "./integration/scenario";

test("optional traffic dynamics survive capture, JSON, reports, rerun and comparison without default injection", () => {
  const old = captureRunInputs(layout, workload, "traffic-capture");
  expect(resolveWorkload(workload)).not.toHaveProperty("workloadDynamics");
  expect(old.workloadProfile).not.toHaveProperty("workloadDynamics");
  expect(WorkloadProfileSchema.parse(workload)).toEqual(workload);
  const workloadDynamics = { version: 1 as const, arrivalProcess: "poisson" as const, applicationCpuCv: 0.5 };
  const captured = captureRunInputs(layout, { ...workload, workloadDynamics }, old.seed);
  expect(captured.workloadProfile.workloadDynamics).toEqual(workloadDynamics);
  expect(readRunInputs(JSON.parse(JSON.stringify(captured)))).toEqual(captured);
  expect(currentDesignInput(captured, layout).workloadProfile).toEqual(captured.workloadProfile);
  const report = readRecords({ runInputs: captured, workloadProfile: captured.workloadProfile, stages: [], timeline: [], chaosEvents: [] }, []);
  expect(report.input!.workloadProfile.workloadDynamics).toEqual(workloadDynamics);
  expect(report.legacyWorkload!.workloadDynamics).toEqual(workloadDynamics);
  expect(compareInputs(old, captured).facets.workload).toBe("different");
  expect(compareInputs(captured, readRunInputs(JSON.parse(JSON.stringify(captured)))).facets.workload).toBe("same");
});

test("traffic dynamics are strict version 1 with finite educational CV from 0 to 1", () => {
  for (const value of [null, {}, { version: 2, arrivalProcess: "even", applicationCpuCv: 0 },
    ...[-1, 1.1, NaN, Infinity].map(applicationCpuCv => ({ version: 1, arrivalProcess: "even", applicationCpuCv })),
    { version: 1, arrivalProcess: "random", applicationCpuCv: 0 },
    { version: 1, arrivalProcess: "even", applicationCpuCv: 0, extra: true }]) {
    expect(workloadDynamicsError(value)).not.toBeNull();
    expect(WorkloadProfileSchema.safeParse({ ...workload, workloadDynamics: value }).success).toBe(false);
  }
  expect(workloadDynamicsError(undefined)).toBeNull();
  for (const applicationCpuCv of [0, 0.5, 1]) expect(workloadDynamicsError({ version: 1, arrivalProcess: "even", applicationCpuCv })).toBeNull();
});
