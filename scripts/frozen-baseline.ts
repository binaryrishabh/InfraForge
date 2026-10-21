import { digest } from "../apps/backend/executionIdentity/hash";
import type { SourceTree } from "../apps/backend/executionIdentity/sourceTree";
import { historicalAnalysisDescriptor } from "./historical-analysis-descriptor";
import { historicalIsolationDescriptor } from "./historical-isolation-descriptor";
import { historicalDeclaredHostDescriptor } from "./historical-declared-host-descriptor";

export const frozenBaselineAlgorithms = [
  { id: "analysis-boundary/1" as const, reconstruct: historicalAnalysisDescriptor },
  { id: "isolation-boundary/1" as const, reconstruct: historicalIsolationDescriptor },
  { id: "declared-host-boundary/1" as const, reconstruct: historicalDeclaredHostDescriptor },
];

export function selectFrozenBaseline(tree: SourceTree, runtime: string, expected: string) {
  const rejected: string[] = [];
  for (const algorithm of frozenBaselineAlgorithms) {
    try {
      if (digest(algorithm.reconstruct(tree, runtime)) === expected) return algorithm.id;
      rejected.push(`${algorithm.id}: digest differs`);
    } catch (error) {
      // A frozen version may reject syntax introduced after it. Only an exact
      // complete reconstruction by another version can accept the baseline.
      rejected.push(`${algorithm.id}: ${error instanceof Error ? error.message : "rejected"}`);
    }
  }
  throw Error(`Baseline descriptor does not reconstruct (${rejected.join("; ")})`);
}
