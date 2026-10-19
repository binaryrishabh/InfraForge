import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executionIdentity } from "../internalModel2/identity";
import { repositoryRoot } from "./descriptor";
import { sha256 } from "./hash";

// All resources enter the descriptor before execution. No caller-supplied path can
// expand the inventory, including environment-selected paths. Recheck immutable bytes.
export function executionResource(path: string): Uint8Array {
  const expected = executionIdentity.resources.find(([name]) => name === path)?.[1];
  if (!expected) throw Error("Uninventoried execution resource");
  const bytes = readFileSync(resolve(repositoryRoot, path));
  if (sha256(bytes.toString("base64")) !== expected) throw Error("Execution resource drift");
  return bytes;
}

export function compileExecutionWasm(path: string) {
  return WebAssembly.compile(executionResource(path) as Uint8Array<ArrayBuffer>);
}
