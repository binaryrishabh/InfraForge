import { historicalContentHash as sha256 } from "./historical-analysis-cache";
import { historicalLaunchDescriptor } from "./historical-launch-descriptor";
import type { SourceTree } from "../apps/backend/executionIdentity/sourceTree";

// Frozen delta for the committed loading-analysis boundary (3837b94).
// Its descriptor also pins the reviewed analysis data; earlier algorithms do not.
export function historicalAnalysisDescriptor(tree: SourceTree, runtime: string) {
  const base = historicalLaunchDescriptor(tree, runtime);
  const path = "apps/backend/executionIdentity/analysisContract.json";
  return { ...base, files: [...base.files, [path, sha256(tree.read(path))]].sort((a, b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0) };
}
