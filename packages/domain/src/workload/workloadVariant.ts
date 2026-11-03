import type { WorkloadProfile } from "./WorkloadProfile.interface";
import { workloadDynamicsError } from "./workloadDynamics";

export type WorkloadVariant = { dimension: "arrival-process"; value: "even" | "poisson" } |
  { dimension: "application-cpu-variability"; value: "fixed" | "moderate" | "high" };
export type WorkloadVariantSource = { arrivalProcess: "even" | "poisson"; applicationCpuVariability: "fixed" | "moderate" | "high" | "custom" };
const cpuCv = { fixed: 0, moderate: 0.5, high: 1 } as const;

export function workloadVariantError(value: unknown): string | null {
  const reason = "Choose one workload variant: arrival-process (even/poisson) or application-cpu-variability (fixed/moderate/high).";
  if (!value || typeof value !== "object" || Array.isArray(value)) return reason;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 2 || Object.keys(v).some(k => k !== "dimension" && k !== "value")) return reason;
  return (v.dimension === "arrival-process" && (v.value === "even" || v.value === "poisson")) ||
    (v.dimension === "application-cpu-variability" && (v.value === "fixed" || v.value === "moderate" || v.value === "high")) ? null : reason;
}

export function describeWorkloadVariantSource(profile: WorkloadProfile): WorkloadVariantSource {
  const error = workloadDynamicsError(profile.workloadDynamics);
  if (error) throw new Error(error);
  const cv = profile.workloadDynamics?.applicationCpuCv ?? 0;
  return { arrivalProcess: profile.workloadDynamics?.arrivalProcess ?? "even",
    applicationCpuVariability: cv === 0 ? "fixed" : cv === 0.5 ? "moderate" : cv === 1 ? "high" : "custom" };
}

export function applyWorkloadVariant(profile: WorkloadProfile, variant: WorkloadVariant): WorkloadProfile {
  const error = workloadVariantError(variant);
  if (error) throw new Error(error);
  const source = describeWorkloadVariantSource(profile);
  if (variant.dimension === "application-cpu-variability" && source.applicationCpuVariability === "custom") {
    throw new Error("Captured application CPU variability is custom; this dimension cannot be varied in v1.");
  }
  if (variant.value === (variant.dimension === "arrival-process" ? source.arrivalProcess : source.applicationCpuVariability)) return profile;
  const arrivalProcess = variant.dimension === "arrival-process" ? variant.value : source.arrivalProcess;
  const applicationCpuCv = variant.dimension === "application-cpu-variability" ? cpuCv[variant.value] : profile.workloadDynamics?.applicationCpuCv ?? 0;
  const { workloadDynamics: _, ...rest } = profile;
  return arrivalProcess === "even" && applicationCpuCv === 0 ? rest :
    { ...rest, workloadDynamics: { version: 1, arrivalProcess, applicationCpuCv } };
}
