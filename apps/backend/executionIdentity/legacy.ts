import { digest } from "./hash";
import { wholeLockFiles } from "./descriptor";
import type { SourceTree } from "./descriptor";

// Keep the original whole-text algorithm for reconstruction, never for new runs.
export function wholeLockIdentity(tree: SourceTree, runtime: string, includeSandbox = false) {
  return digest({ runtime, files: wholeLockFiles(tree, includeSandbox).map(path => [path, tree.read(path)]) });
}
