// Frozen descriptor delta for the committed privileged-import boundary (53188f7).
// The host algorithm already traverses the capability implementation as source;
// this revision additionally inventories its explicitly read review data.
import { historicalHostDescriptor } from "./historical-host-descriptor";
import type { SourceTree } from "../apps/backend/executionIdentity/sourceTree";
import { sha256 } from "../apps/backend/executionIdentity/hash";
export function historicalImportDescriptor(tree: SourceTree, runtime: string) {
  const descriptor = historicalHostDescriptor(tree, runtime);
  const path = "apps/backend/executionIdentity/capabilityImportReviews.json";
  return { ...descriptor, files: [...descriptor.files, [path, sha256(tree.read(path))]].sort((a,b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0) };
}
