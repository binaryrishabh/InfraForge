import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { buildRerunOptions, rerunInputHash } from "../reruns/options";
import { createWorkloadVariantInput } from "../reruns/variants";
import { rerunCreation } from "../reruns/request";
import type { StoredRun } from "../reports/report";
import { layout, workload } from "./integration/scenario";

const input = captureRunInputs(layout, workload, "variants");
function source(changes: Partial<StoredRun> = {}): StoredRun {
  return {id: "source", infrastructureId: null, runName: "Source", status: "completed", resourceCount: input.resources.length,
    createdAt: new Date(0), updatedAt: new Date(0), topologyRevision: 0, stages: [], timeline: [], chaosEvents: [],
    workloadProfile: input.workloadProfile, seed: input.seed, simulationState: null, runInputs: input, liveTopology: layout,
    terminalSnapshot: {version: 1, kind: "terminal", capturedAt: new Date(0).toISOString(), topologyRevision: 0,
      simulatedSeconds: 20, accumulatedCostUsd: 0, overallHealth: "healthy", metrics: {}}, ...changes};
}
test("designless completed and failed sources list all five choices with current values refused", () => {
  for (const status of ["completed", "failed", "torn-down"] as const) {
    const options = buildRerunOptions(source({status}), null);
    expect(options.workloadVariant).toMatchObject({available: true, reason: null, source: {arrivalProcess: "even", applicationCpuVariability: "fixed"}});
    expect(options.workloadVariant.choices).toHaveLength(5);
    for (const choice of options.workloadVariant.choices) {
      if (["even", "fixed"].includes(choice.variant.value)) expect(choice).toMatchObject({available: false, reason: "Already the source setting.", preview: null, inputHash: null});
      else {
        expect(choice.available).toBe(true);
        expect(choice.preview?.grade).toBe("one-change-workload");
        expect(choice.inputHash).toBe(rerunInputHash(createWorkloadVariantInput(input, choice.variant)));
      }
    }
    expect(options.matchedStop).toMatchObject({defaultEnabled: true, target: 20});
  }
});
test("source refusal reasons remain explicit without reconstructing or dropping unsupported fields", () => {
  const cases: Array<[Partial<StoredRun>, string]> = [
    [{status: "live"}, "Wait for this run to finish or stop it first."],
    [{runInputs: null}, "Exact rerun requires readable captured V2 input; legacy provenance cannot be invented."],
    [{runInputs: {...input, version: 1}}, "This run used the retired Model 1. Its report stays readable, but it cannot be rerun; deploy the design again for a new run."],
    [{runInputs: {...input, simulationModelVersion: "1"}}, "This run used the retired Model 1. Its report stays readable, but it cannot be rerun; deploy the design again for a new run."],
    [{runInputs: {...input, catalogSnapshot: "old"}}, "Captured model/catalog differs from the current runtime. Exact rerun is unavailable."],
    [{runInputs: {...input, extra: true}}, "Captured input contains unsupported fields. Exact rerun cannot silently discard them."],
    [{challengeId: "challenge", challengeVersion: 1}, "Workload variants require a freeform source without a challenge or scenario."],
    [{challengeScenario: {}}, "Workload variants require a freeform source without a challenge or scenario."],
  ];
  for (const [changes, reason] of cases) expect(buildRerunOptions(source(changes), null).workloadVariant).toMatchObject({available: false, reason});
  expect(buildRerunOptions({...source(), runtimeActive: true}, null).workloadVariant.available).toBe(false);
  expect(buildRerunOptions(source({terminalSnapshot: null}), null).matchedStop.available).toBe(false);
});
test("every dimension/value preserves every other captured byte by value, including historical profiles", () => {
  for (const arrivalProcess of ["even", "poisson"] as const) for (const applicationCpuCv of [0, 0.5, 1]) for (const profiles of [undefined, [], input.adapterProfiles]) {
    const original = {...input, workloadProfile: {...input.workloadProfile, workloadDynamics: {version: 1 as const, arrivalProcess, applicationCpuCv}}};
    if (profiles === undefined) delete original.adapterProfiles; else original.adapterProfiles = profiles;
    const options = buildRerunOptions(source({runInputs: original}), null);
    for (const choice of options.workloadVariant.choices.filter(c => c.available)) {
      const candidate = createWorkloadVariantInput(original, choice.variant);
      expect({...candidate, workloadProfile: {...candidate.workloadProfile, workloadDynamics: original.workloadProfile.workloadDynamics}}).toEqual(original);
      expect(candidate.adapterProfiles).toEqual(original.adapterProfiles);
      expect(Object.hasOwn(candidate, "adapterProfiles")).toBe(Object.hasOwn(original, "adapterProfiles"));
    }
  }
});
test("custom CPU values are never rounded; corrupt dynamics and no-op candidates refuse", () => {
  const custom = {...input, workloadProfile: {...input.workloadProfile, workloadDynamics: {version: 1 as const, arrivalProcess: "even" as const, applicationCpuCv: 0.3}}};
  const options = buildRerunOptions(source({runInputs: custom}), null).workloadVariant;
  expect(options.source?.applicationCpuVariability).toBe("custom");
  expect(options.choices.filter(c => c.variant.dimension === "application-cpu-variability").every(c => !c.available && c.reason?.includes("custom"))).toBe(true);
  expect(options.choices.find(c => c.variant.value === "poisson")?.available).toBe(true);
  expect(() => createWorkloadVariantInput(input, {dimension: "arrival-process", value: "even"})).toThrow("Already the source setting.");
  expect(buildRerunOptions(source({runInputs: {...custom, workloadProfile: {...custom.workloadProfile, workloadDynamics: {...custom.workloadProfile.workloadDynamics, extra: 1}}}}), null).workloadVariant.available).toBe(false);
});
test("creation accepts only an explicit strict variant and preview hash, never client engine/topology", () => {
  const request = {mode: "workload-variant", matchedStop: true, variant: {dimension: "arrival-process", value: "poisson"}, expectedInputHash: "a".repeat(64)};
  expect(rerunCreation.safeParse(request).success).toBe(true);
  for (const value of [{...request, variant: undefined}, {...request, expectedInputHash: undefined}, {...request, resources: []},
    {...request, simulationModelVersion: "other"}, {...request, variant: {...request.variant, seed: "other"}}, {...request, mode: "exact"}, {...request, mode: "current-design"}]) {
    expect(rerunCreation.safeParse(value).success).toBe(false);
  }
  expect(rerunCreation.safeParse({mode: "exact", matchedStop: false}).success).toBe(true);
});
