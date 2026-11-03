import type { RunSummary } from "./report";
import type { StartingComparison } from "./compare";
import type { WorkloadProfile, WorkloadVariant, WorkloadVariantSource } from "@infraforge/domain/workload";
export type { WorkloadVariant, WorkloadVariantSource } from "@infraforge/domain/workload";

export type RerunMode = "exact" | "current-design" | "workload-variant";
export interface RerunOptions {
  source: RunSummary;
  workload: WorkloadProfile | null; seed: string | null;
  exact: { available: boolean; reason: string | null };
  currentDesign: { available: boolean; reason: string | null; preview: StartingComparison | null; inputHash: string | null; modelCatalogCompatible: boolean };
  workloadVariant: { available: boolean; reason: string | null; source: WorkloadVariantSource | null;
    choices: Array<{ variant: WorkloadVariant; available: boolean; reason: string | null; preview: StartingComparison | null; inputHash: string | null }> };
  matchedStop: { available: boolean; target: number | null; defaultEnabled: boolean; reason: string | null };
}
export interface RunFamily {
  source: RunSummary | null;
  reruns: Array<{ run: RunSummary; starting: StartingComparison }>;
  truncated: boolean; limit: number;
}
