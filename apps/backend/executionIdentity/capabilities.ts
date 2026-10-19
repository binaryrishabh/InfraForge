import { sourceHash } from "./hash";
import type { SourceTree } from "./sourceTree";
const pureBuiltins = new Set(["crypto", "path", "path/posix", "path/win32", "url", "buffer", "events", "assert", "assert/strict", "util", "util/types", "string_decoder", "querystring", "readline", "readline/promises"]);
export const pureBuiltin = (name: string) => pureBuiltins.has(name);
interface Reviews { modules: Record<string, string>; facades: Record<string, string>; alternatives?: Record<string,string[]> }
// Privileged implementations cannot be laundered through aliases, re-exports or
// package wrappers. Unknown consumers require exact source review. The two narrow
// facades expose hashes/identity and inventoried resources, never a generic reader.
export function verifyCapabilityImports(tree: SourceTree, direct: Set<string>, edges: Array<[string,string]>, review?: (required: Record<string,string>) => void) {
  const approved = JSON.parse(tree.read("apps/backend/executionIdentity/capabilityImportReviews.json")) as Reviews;
  const tainted = new Set(direct), hashes = new Map<string,string>();
  const hash = (path: string) => { if (!hashes.has(path)) hashes.set(path, sourceHash(tree.read(path))); return hashes.get(path)!; };
  const facade = (path: string) => approved.facades[path] === hash(path);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from,to] of edges) if (tainted.has(to) && !facade(to) && !tainted.has(from)) { tainted.add(from); changed = true; }
  }
  const required = Object.fromEntries([...tainted].sort().map(path => [path, hash(path)]));
  if (review) review(required);
  else for (const [path,hash] of Object.entries(required)) if (approved.modules[path] !== hash && !approved.alternatives?.[path]?.includes(hash)) throw Error(`Unreviewed execution capability import: ${path}`);
}
