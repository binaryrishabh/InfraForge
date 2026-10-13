import type { RunSummary } from "./report";
import type { StartingComparison } from "./compare";
import type { WorkloadProfile } from "@infraforge/domain/workload";

export type RerunMode = "exact" | "current-design";
export interface RerunOptions {
  source: RunSummary;
  workload: WorkloadProfile | null; seed: string | null;
  exact: { available: boolean; reason: string | null };
  currentDesign: { available: boolean; reason: string | null; preview: StartingComparison | null; inputHash: string | null; modelCatalogCompatible: boolean };
  matchedStop: { available: boolean; target: number | null; defaultEnabled: boolean; reason: string | null };
}
export interface RunFamily {
  source: RunSummary | null;
  reruns: Array<{ run: RunSummary; starting: StartingComparison }>;
  truncated: boolean; limit: number;
}
