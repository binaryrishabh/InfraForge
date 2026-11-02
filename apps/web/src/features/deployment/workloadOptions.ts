import type { WorkloadProfile, WorkloadDynamics, ResolvedWorkloadProfile } from "@infraforge/domain/workload";

interface Preset { id: string; label: string; profile: ResolvedWorkloadProfile }
export const WORKLOAD_PRESETS: Preset[] = [
  { id: "steady", label: "Steady", profile: { targetThroughput: 1_000_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" } },
  { id: "peak", label: "Peak hours", profile: { targetThroughput: 1_000_000, throughputUnit: "per-hour", trafficShape: "peak", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" } },
  { id: "sale", label: "Flash sale", profile: { targetThroughput: 2_000_000, throughputUnit: "per-hour", trafficShape: "peak", peakMultiplier: 5, readWriteRatio: 0.9, payloadSize: "heavy" } },
  { id: "bots", label: "Bot traffic", profile: { targetThroughput: 3_000_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.95, payloadSize: "light" } },
  { id: "writes", label: "Write-heavy", profile: { targetThroughput: 1_000_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.3, payloadSize: "medium" } },
  { id: "bursty-api", label: "Bursty API", profile: { targetThroughput: 1_000_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium", workloadDynamics: { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 } } },
];

export function withWorkloadDynamics(p: WorkloadProfile, patch: Partial<Omit<WorkloadDynamics, "version">>): WorkloadProfile {
  return { ...p, workloadDynamics: { version: 1, arrivalProcess: "even", applicationCpuCv: 0, ...p.workloadDynamics, ...patch } };
}
