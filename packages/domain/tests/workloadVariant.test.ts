import { expect, test } from "bun:test";
import { applyWorkloadVariant, describeWorkloadVariantSource, workloadVariantError, type WorkloadVariant } from "../src/workload";
import type { WorkloadProfile } from "../src/workload";

const profile: WorkloadProfile = { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", payloadSize: "light" };
test("variants strictly whitelist one dimension and reject unknown keys", () => {
  for (const value of [null, [], {}, {dimension: "seed", value: "even"}, {dimension: "arrival-process", value: "high"},
    {dimension: "arrival-process", value: "even", seed: "other"}]) expect(workloadVariantError(value)).not.toBeNull();
  expect(workloadVariantError({dimension: "arrival-process", value: "poisson"})).toBeNull();
  for (const value of ["fixed", "moderate", "high"]) expect(workloadVariantError({dimension: "application-cpu-variability", value})).toBeNull();
});
test("variants preserve other fields, round trip canonically and detect no-ops", () => {
  const variants: WorkloadVariant[] = [{dimension: "arrival-process", value: "poisson"},
    ...(["fixed", "moderate", "high"] as const).map(value => ({dimension: "application-cpu-variability" as const, value}))];
  expect(applyWorkloadVariant(profile, {dimension: "arrival-process", value: "even"})).toEqual(profile);
  for (const variant of variants) {
    const candidate = applyWorkloadVariant(profile, variant);
    const {workloadDynamics: _, ...rest} = candidate;
    expect(rest).toEqual(profile);
    expect(applyWorkloadVariant(candidate, variant)).toEqual(candidate);
    const back = applyWorkloadVariant(candidate, variant.dimension === "arrival-process" ? {dimension: "arrival-process", value: "even"} : {dimension: "application-cpu-variability", value: "fixed"});
    expect(back).toEqual(profile);
  }
});
test("custom CV is described without rounding and only its own dimension is refused", () => {
  const custom = {...profile, workloadDynamics: {version: 1 as const, arrivalProcess: "even" as const, applicationCpuCv: 0.3}};
  expect(describeWorkloadVariantSource(custom)).toEqual({arrivalProcess: "even", applicationCpuVariability: "custom"});
  expect(() => applyWorkloadVariant(custom, {dimension: "application-cpu-variability", value: "moderate"})).toThrow("custom");
  expect(applyWorkloadVariant(custom, {dimension: "arrival-process", value: "poisson"}).workloadDynamics?.applicationCpuCv).toBe(0.3);
  expect(() => applyWorkloadVariant({...custom, workloadDynamics: {...custom.workloadDynamics, applicationCpuCv: NaN}}, {dimension: "arrival-process", value: "poisson"})).toThrow();
});
